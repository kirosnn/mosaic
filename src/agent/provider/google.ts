import { streamText, CoreMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { getGoogleReasoningOptions, resolveReasoningEnabled } from './reasoningConfig';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { refreshGoogleOAuthToken } from '../../auth/oauth';
import { setOAuthTokenForProvider } from '../../utils/config';
import { debugLog, maskToken } from '../../utils/debug';
import { StreamSanitizer } from './streamSanitizer';
import { ContextGuard } from './contextGuard';

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

let cachedProjectId: string | null = null;
type ThoughtSignatureEntry = { toolName: string; argsJson: string; thoughtSignature: string };
let cachedThoughtSignatures: ThoughtSignatureEntry[] = [];
const MAX_CACHED_THOUGHT_SIGNATURES = 1024;

const CLIENT_METADATA = {
  ideType: 'GEMINI_CLI',
  pluginType: 'GEMINI',
};

interface LoadCodeAssistResponse {
  currentTier?: { id?: string } | null;
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }> | null;
  cloudaicompanionProject?: string | null;
}

interface LongRunningOperationResponse {
  name?: string;
  done?: boolean;
  response?: {
    cloudaicompanionProject?: { id?: string; name?: string };
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractFunctionCallThoughtSignatures(payload: any): ThoughtSignatureEntry[] {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return [];

  const out: ThoughtSignatureEntry[] = [];
  for (const part of parts) {
    const functionCall = part?.functionCall;
    const thoughtSignature = part?.thoughtSignature;
    if (!functionCall || typeof functionCall.name !== 'string' || typeof thoughtSignature !== 'string') {
      continue;
    }
    out.push({
      toolName: functionCall.name,
      argsJson: safeJsonStringify(functionCall.args),
      thoughtSignature,
    });
  }
  return out;
}

function mergeThoughtSignatures(entries: ThoughtSignatureEntry[]): number {
  if (entries.length === 0) return 0;
  cachedThoughtSignatures.push(...entries);

  if (cachedThoughtSignatures.length > MAX_CACHED_THOUGHT_SIGNATURES) {
    cachedThoughtSignatures = cachedThoughtSignatures.slice(-MAX_CACHED_THOUGHT_SIGNATURES);
  }
  return entries.length;
}

function findLatestSignatureIndex(
  used: Set<number>,
  matcher: (entry: ThoughtSignatureEntry) => boolean
): number {
  for (let i = cachedThoughtSignatures.length - 1; i >= 0; i--) {
    if (used.has(i)) continue;
    if (matcher(cachedThoughtSignatures[i]!)) return i;
  }
  return -1;
}

function injectThoughtSignaturesIntoRequest(requestBody: any): { injected: number; totalModelFunctionCalls: number; missing: number } {
  const contents = requestBody?.contents;
  if (!Array.isArray(contents)) {
    return { injected: 0, totalModelFunctionCalls: 0, missing: 0 };
  }

  const modelFunctionCalls: Array<{ part: any; toolName: string; argsJson: string }> = [];
  for (const content of contents) {
    if (!content || content.role !== 'model' || !Array.isArray(content.parts)) continue;
    for (const part of content.parts) {
      const functionCall = part?.functionCall;
      if (!functionCall || typeof functionCall.name !== 'string') continue;
      modelFunctionCalls.push({
        part,
        toolName: functionCall.name,
        argsJson: safeJsonStringify(functionCall.args),
      });
    }
  }

  if (modelFunctionCalls.length === 0 || cachedThoughtSignatures.length === 0) {
    const missing = modelFunctionCalls.reduce((acc, call) => {
      return acc + ((typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) ? 0 : 1);
    }, 0);
    return { injected: 0, totalModelFunctionCalls: modelFunctionCalls.length, missing };
  }

  const used = new Set<number>();
  let injected = 0;
  const unresolved: Array<{ part: any; toolName: string }> = [];

  for (let i = modelFunctionCalls.length - 1; i >= 0; i--) {
    const call = modelFunctionCalls[i]!;
    if (typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) continue;

    let index = findLatestSignatureIndex(
      used,
      (entry) => entry.toolName === call.toolName && entry.argsJson === call.argsJson
    );
    if (index < 0) {
      unresolved.push({ part: call.part, toolName: call.toolName });
      continue;
    }

    call.part.thoughtSignature = cachedThoughtSignatures[index]!.thoughtSignature;
    used.add(index);
    injected++;
  }

  for (let i = unresolved.length - 1; i >= 0; i--) {
    const pending = unresolved[i]!;
    if (typeof pending.part.thoughtSignature === 'string' && pending.part.thoughtSignature.length > 0) continue;
    const index = findLatestSignatureIndex(
      used,
      (entry) => entry.toolName === pending.toolName
    );
    if (index < 0) continue;
    pending.part.thoughtSignature = cachedThoughtSignatures[index]!.thoughtSignature;
    used.add(index);
    injected++;
  }

  const missing = modelFunctionCalls.reduce((acc, call) => {
    return acc + ((typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) ? 0 : 1);
  }, 0);
  return { injected, totalModelFunctionCalls: modelFunctionCalls.length, missing };
}

function isCacheableTool(toolName: string): boolean {
  if (toolName.startsWith('mcp__')) return true;
  return (
    toolName === 'list' ||
    toolName === 'glob' ||
    toolName === 'grep' ||
    toolName === 'read' ||
    toolName === 'fetch' ||
    toolName === 'explore'
  );
}

function buildMemoizedTools(
  tools: Record<string, any> | undefined
): Record<string, any> | undefined {
  if (!tools) return tools;
  const cache = new Map<string, unknown>();
  const wrapped: Record<string, any> = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool || typeof (tool as any).execute !== 'function' || !isCacheableTool(toolName)) {
      wrapped[toolName] = tool;
      continue;
    }

    wrapped[toolName] = {
      ...tool,
      execute: async (args: any, options: any) => {
        const argsJson = safeJsonStringify(args);
        const key = `${toolName}\n${argsJson}`;
        if (cache.has(key)) {
          debugLog(`[google] tool-cache hit ${toolName} args=${argsJson.slice(0, 100)}`);
          return cache.get(key);
        }
        const result = await (tool as any).execute(args, options);
        cache.set(key, result);
        return result;
      },
    };
  }

  return wrapped;
}

function codeAssistHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}

async function loadCodeAssist(accessToken: string): Promise<LoadCodeAssistResponse> {
  const res = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
    method: 'POST',
    headers: codeAssistHeaders(accessToken),
    body: JSON.stringify({
      metadata: { ...CLIENT_METADATA, duetProject: 'default-project' },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    debugLog(`[oauth][google] loadCodeAssist failed status=${res.status} body=${text.slice(0, 500)}`);
    throw new Error(`Google Code Assist loadCodeAssist failed (${res.status})`);
  }
  return await res.json() as LoadCodeAssistResponse;
}

async function onboardUser(accessToken: string): Promise<LongRunningOperationResponse> {
  const res = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:onboardUser`, {
    method: 'POST',
    headers: codeAssistHeaders(accessToken),
    body: JSON.stringify({
      tierId: 'free-tier',
      metadata: CLIENT_METADATA,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    debugLog(`[oauth][google] onboardUser failed status=${res.status} body=${text.slice(0, 500)}`);
    throw new Error(`Google Code Assist onboarding failed (${res.status})`);
  }
  return await res.json() as LongRunningOperationResponse;
}

async function pollOperation(accessToken: string, operationName: string): Promise<LongRunningOperationResponse> {
  const res = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}/${operationName}`, {
    method: 'GET',
    headers: codeAssistHeaders(accessToken),
  });
  if (!res.ok) {
    const text = await res.text();
    debugLog(`[oauth][google] getOperation failed status=${res.status} body=${text.slice(0, 500)}`);
    throw new Error(`Google Code Assist operation poll failed (${res.status})`);
  }
  return await res.json() as LongRunningOperationResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function discoverProjectId(accessToken: string): Promise<string> {
  if (cachedProjectId) return cachedProjectId;

  const loadResponse = await loadCodeAssist(accessToken);
  debugLog(`[oauth][google] loadCodeAssist response: project=${loadResponse.cloudaicompanionProject ?? 'none'} currentTier=${loadResponse.currentTier?.id ?? 'none'}`);

  if (loadResponse.cloudaicompanionProject) {
    cachedProjectId = loadResponse.cloudaicompanionProject;
    debugLog(`[oauth][google] discovered projectId=${cachedProjectId}`);
    return cachedProjectId;
  }

  debugLog('[oauth][google] no project found, starting onboarding...');
  const lro = await onboardUser(accessToken);
  debugLog(`[oauth][google] onboardUser response: done=${lro.done} name=${lro.name ?? 'none'}`);

  if (lro.done && lro.response?.cloudaicompanionProject?.id) {
    cachedProjectId = lro.response.cloudaicompanionProject.id;
    debugLog(`[oauth][google] onboarding complete, projectId=${cachedProjectId}`);
    return cachedProjectId;
  }

  if (lro.name) {
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const op = await pollOperation(accessToken, lro.name);
      debugLog(`[oauth][google] poll ${i + 1}/24: done=${op.done}`);
      if (op.done) {
        if (op.response?.cloudaicompanionProject?.id) {
          cachedProjectId = op.response.cloudaicompanionProject.id;
          debugLog(`[oauth][google] onboarding complete after polling, projectId=${cachedProjectId}`);
          return cachedProjectId;
        }
        const reloaded = await loadCodeAssist(accessToken);
        if (reloaded.cloudaicompanionProject) {
          cachedProjectId = reloaded.cloudaicompanionProject;
          debugLog(`[oauth][google] found projectId after reload: ${cachedProjectId}`);
          return cachedProjectId;
        }
        break;
      }
    }
  }

  throw new Error('Google Code Assist onboarding timed out. Try running Gemini CLI first to complete setup.');
}

function unwrapCodeAssistSSE(originalRes: Response): Response {
  const reader = originalRes.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstEventLogged = false;

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          controller.enqueue(new TextEncoder().encode(buffer));
        }
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      const outputLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) {
            outputLines.push(line);
            continue;
          }
          if (!firstEventLogged) {
            debugLog(`[oauth][google] first SSE event: ${jsonStr.slice(0, 500)}`);
            firstEventLogged = true;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const payload = parsed.response && !parsed.candidates ? parsed.response : parsed;
            const extracted = extractFunctionCallThoughtSignatures(payload);
            if (extracted.length > 0) {
              const added = mergeThoughtSignatures(extracted);
              debugLog(`[oauth][google] captured thoughtSignature for ${extracted.length} function call(s), added=${added}, cache=${cachedThoughtSignatures.length}`);
            }
            if (parsed.response && !parsed.candidates) {
              outputLines.push('data: ' + JSON.stringify(parsed.response));
            } else {
              outputLines.push(line);
            }
          } catch {
            outputLines.push(line);
          }
        } else {
          outputLines.push(line);
        }
      }

      if (outputLines.length > 0) {
        controller.enqueue(new TextEncoder().encode(outputLines.join('\n') + '\n'));
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: originalRes.status,
    statusText: originalRes.statusText,
    headers: originalRes.headers,
  });
}

function extractModelFromUrl(url: string): string | null {
  const match = url.match(/\/models\/([^/:]+)/);
  return match?.[1] ?? null;
}

function extractActionFromUrl(url: string): string | null {
  const match = url.match(/:([a-zA-Z]+)(?:\?|$)/);
  return match?.[1] ?? null;
}

const QUOTA_MIN_DELAY = 2000;
const QUOTA_MAX_DELAY = 120000;
const QUOTA_MAX_RETRIES = 10;

function parseQuotaResetDelay(body: string): number {
  try {
    const parsed = JSON.parse(body);
    const message: string = parsed?.error?.message ?? '';
    const details: any[] | undefined = parsed?.error?.details;

    let metadataDelay: number | undefined;
    if (Array.isArray(details)) {
      for (const detail of details) {
        const raw = detail?.metadata?.quotaResetDelay;
        if (typeof raw === 'string') {
          const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)?$/i);
          if (m) {
            const amount = parseFloat(m[1]!);
            const unit = (m[2] || 's').toLowerCase();
            const mult = unit === 'ms' ? 1 : unit === 'm' ? 60000 : 1000;
            metadataDelay = Math.round(amount * mult);
          }
        }
      }
    }

    let messageDelay: number | undefined;
    const msgMatch = message.match(/reset after (\d+)s/i);
    if (msgMatch) {
      messageDelay = parseInt(msgMatch[1]!, 10) * 1000;
    }

    const delay = Math.max(metadataDelay ?? 0, messageDelay ?? 0);
    return Math.min(QUOTA_MAX_DELAY, Math.max(QUOTA_MIN_DELAY, delay));
  } catch {
    return QUOTA_MIN_DELAY;
  }
}

function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(timer); resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export class GoogleProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);

    let oauthAuth = config.auth?.type === 'oauth' ? config.auth : undefined;

    const googleReasoning = getGoogleReasoningOptions(reasoningEnabled);

    const refreshOauthIfNeeded = async (force = false): Promise<typeof oauthAuth> => {
      if (!oauthAuth?.refreshToken) return oauthAuth;
      if (!force && oauthAuth.expiresAt && Date.now() < oauthAuth.expiresAt - 60000) return oauthAuth;
      if (force) {
        debugLog(`[oauth][google] force refresh requested, invalidating current token`);
        if (oauthAuth.expiresAt) {
          oauthAuth = { ...oauthAuth, expiresAt: 0 };
        }
      }
      const refreshed = await refreshGoogleOAuthToken(oauthAuth.refreshToken!);
      if (!refreshed) {
        debugLog(`[oauth][google] refresh returned null, token may be permanently invalid`);
        return oauthAuth;
      }
      const updated = {
        type: 'oauth' as const,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        tokenType: refreshed.tokenType,
        scope: refreshed.scope,
      };
      config.auth = updated;
      oauthAuth = updated;
      setOAuthTokenForProvider('google', {
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
        expiresAt: updated.expiresAt,
        tokenType: updated.tokenType,
        scope: updated.scope,
      });
      return updated;
    };

    const fetchWithOAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const active = await refreshOauthIfNeeded();
      const accessToken = active?.accessToken;

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) {
        const extra = new Headers(init.headers);
        extra.forEach((value, key) => headers.set(key, value));
      }
      headers.delete('x-goog-api-key');
      headers.delete('Authorization');
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('Content-Type', 'application/json');

      let url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);

      const model = extractModelFromUrl(url);
      const action = extractActionFromUrl(url);

      if (model && action) {
        const projectId = await discoverProjectId(accessToken!);
        const targetUrl = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${action}?alt=sse`;

        let bodyText: string | undefined;
        if (typeof init?.body === 'string') {
          bodyText = init.body;
        } else if (init?.body instanceof Uint8Array) {
          bodyText = new TextDecoder().decode(init.body);
        } else if (init?.body instanceof ArrayBuffer) {
          bodyText = new TextDecoder().decode(new Uint8Array(init.body));
        }

        let wrappedBody: string;
        if (bodyText) {
          try {
            const originalBody = JSON.parse(bodyText);
            if (oauthAuth && action === 'streamGenerateContent') {
              const injection = injectThoughtSignaturesIntoRequest(originalBody);
              if (injection.totalModelFunctionCalls > 0) {
                debugLog(`[oauth][google] thoughtSignature injection injected=${injection.injected} totalModelFunctionCalls=${injection.totalModelFunctionCalls} missing=${injection.missing} cache=${cachedThoughtSignatures.length}`);
              }
            }
            wrappedBody = JSON.stringify({
              model: model,
              project: projectId,
              request: originalBody,
            });
          } catch {
            wrappedBody = bodyText;
          }
        } else {
          wrappedBody = JSON.stringify({
            model: `models/${model}`,
            project: projectId,
            request: {},
          });
        }

        debugLog(`[oauth][google] ${init?.method ?? 'POST'} ${url} -> ${targetUrl} model=${model} project=${projectId} token=${maskToken(accessToken)}`);

        let auth401Retries = 0;
        const MAX_AUTH_RETRIES = 2;

        for (let fetchAttempt = 0; ; fetchAttempt++) {
          const res = await fetch(targetUrl, {
            ...init,
            headers,
            body: wrappedBody,
          });

          if (res.status === 429 && fetchAttempt < QUOTA_MAX_RETRIES) {
            const text = await res.text();
            const delay = parseQuotaResetDelay(text);
            debugLog(`[oauth][google] quota exhausted (attempt ${fetchAttempt + 1}/${QUOTA_MAX_RETRIES}), waiting ${delay}ms | body=${text.slice(0, 300)}`);

            await sleepWithSignal(delay, init?.signal);
            if (init?.signal?.aborted) return res;

            const refreshed = await refreshOauthIfNeeded();
            if (refreshed?.accessToken) {
              headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
            }
            continue;
          }

          if ((res.status === 401 || res.status === 403) && auth401Retries < MAX_AUTH_RETRIES) {
            const text = await res.text();
            auth401Retries++;
            debugLog(`[oauth][google] auth error ${res.status} (attempt ${auth401Retries}/${MAX_AUTH_RETRIES}) | body=${text.slice(0, 300)}`);
            cachedProjectId = null;

            await sleepWithSignal(1000 * auth401Retries, init?.signal);
            if (init?.signal?.aborted) return res;

            const refreshed = await refreshOauthIfNeeded(true);
            if (!refreshed?.accessToken) {
              debugLog(`[oauth][google] force refresh failed after ${res.status}, cannot recover`);
              return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
            }

            headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
            try {
              const newProjectId = await discoverProjectId(refreshed.accessToken);
              if (bodyText) {
                try {
                  const originalBody = JSON.parse(bodyText);
                  wrappedBody = JSON.stringify({ model, project: newProjectId, request: originalBody });
                } catch {}
              }
            } catch (projErr) {
              debugLog(`[oauth][google] project re-discovery failed after auth retry: ${projErr instanceof Error ? projErr.message : projErr}`);
            }
            continue;
          }

          if (!res.ok) {
            const text = await res.clone().text();
            debugLog(`[oauth][google] ${targetUrl} status=${res.status} body=${text.slice(0, 500)}`);
          }
          if (res.ok && res.body && action === 'streamGenerateContent') {
            return unwrapCodeAssistSSE(res);
          }
          return res;
        }
      }

      debugLog(`[oauth][google] passthrough ${init?.method ?? 'GET'} ${url} token=${maskToken(accessToken)}`);
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) {
        const text = await res.clone().text();
        debugLog(`[oauth][google] ${url} status=${res.status} body=${text.slice(0, 500)}`);
      }
      return res;
    };

    const google = createGoogleGenerativeAI({
      apiKey: oauthAuth ? 'oauth' : cleanApiKey,
      fetch: oauthAuth ? (fetchWithOAuth as typeof fetch) : undefined,
    });
    const memoizedTools = buildMemoizedTools(config.tools as Record<string, any> | undefined);
    const oauthSingleToolConstraint = 'Google OAuth constraint: call at most ONE tool per response. Do not batch tool calls. Wait for each tool result before issuing the next tool call.';
    const effectiveSystemPrompt = oauthAuth
      ? (config.systemPrompt ? `${config.systemPrompt}\n\n${oauthSingleToolConstraint}` : oauthSingleToolConstraint)
      : config.systemPrompt;

    debugLog(`[google] starting stream model=${cleanModel} messagesLen=${messages.length} reasoning=${reasoningEnabled} oauth=${!!oauthAuth}`);
    try {
      let stepCounter = 0;

      yield* runWithRetry(async function* () {
        const result = streamText({
          model: google(cleanModel),
          messages: messages,
          system: effectiveSystemPrompt,
          tools: memoizedTools as any,
          maxSteps: config.maxSteps || 100,
          maxTokens: config.maxOutputTokens ?? 16384,
          maxRetries: 0,
          abortSignal: options?.abortSignal,
          providerOptions: googleReasoning ? { google: googleReasoning } : undefined,
        });

        const sanitizer = new StreamSanitizer();
        const contextGuard = new ContextGuard(config.maxContextTokens);

        for await (const chunk of result.fullStream as any) {
          const c: any = chunk;
          switch (c.type) {
            case 'reasoning':
              if (c.textDelta) {
                yield {
                  type: 'reasoning-delta',
                  content: c.textDelta,
                };
              }
              break;

            case 'text-delta': {
              const safe = sanitizer.feed(c.textDelta);
              if (safe !== null) {
                yield { type: 'text-delta', content: safe };
              }
              break;
            }

            case 'step-start':
              sanitizer.reset();
              yield {
                type: 'step-start',
                stepNumber: typeof c.stepIndex === 'number' ? c.stepIndex : stepCounter,
              };
              stepCounter++;
              break;

            case 'step-finish':
              yield {
                type: 'step-finish',
                stepNumber:
                  typeof c.stepIndex === 'number' ? c.stepIndex : Math.max(0, stepCounter - 1),
                finishReason: String(c.finishReason ?? 'stop'),
              };
              break;

            case 'tool-call':
              debugLog(`[google] tool-call ${c.toolName} args=${JSON.stringify(c.args ?? {}).slice(0, 100)}`);
              yield {
                type: 'tool-call-end',
                toolCallId: String(c.toolCallId ?? ''),
                toolName: String(c.toolName ?? ''),
                args: (c.args ?? {}) as Record<string, unknown>,
              };
              break;

            case 'tool-result':
              contextGuard.trackToolResult(c.result);
              yield {
                type: 'tool-result',
                toolCallId: String(c.toolCallId ?? ''),
                toolName: String(c.toolName ?? ''),
                result: c.result,
              };
              if (contextGuard.shouldBreak()) {
                yield { type: 'finish', finishReason: 'length' };
                return;
              }
              break;

            case 'finish': {
              const finishReason = String(c.finishReason ?? 'stop');
              const effectiveFinishReason = finishReason === 'stop' && sanitizer.wasTruncated()
                ? 'length'
                : finishReason;
              if (effectiveFinishReason !== finishReason) {
                debugLog('[google] finish reason remapped stop->length due to sanitizer truncation');
              }
              debugLog(`[google] finish reason=${effectiveFinishReason} promptTokens=${c.usage?.promptTokens ?? '?'} completionTokens=${c.usage?.completionTokens ?? '?'}`);
              yield {
                type: 'finish',
                finishReason: effectiveFinishReason,
                usage: c.usage,
              };
              break;
            }

            case 'error': {
              const err = normalizeError(c.error);
              const decision = getRetryDecision(err);
              if (decision.shouldRetry) {
                throw err;
              }
              yield {
                type: 'error',
                error: err.message,
              };
              break;
            }
          }
        }
      }, { abortSignal: options?.abortSignal, key: config.provider });
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      debugLog(`[google] ERROR ${errorMsg.slice(0, 200)}`);
      yield {
        type: 'error',
        error: errorMsg,
      };
    }
  }
}
