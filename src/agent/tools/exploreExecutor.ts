import { streamText, tool as createTool, CoreTool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { z } from 'zod';
import { readConfig, getAuthForProvider, setOAuthTokenForProvider, mapModelForOAuth } from '../../utils/config';
import { executeTool } from './executor';
import { getExploreAbortSignal, isExploreAborted, notifyExploreTool, getExploreContext } from '../../utils/exploreBridge';
import { refreshOpenAIOAuthToken, refreshGoogleOAuthToken, decodeJwt } from '../../auth/oauth';
import { debugLog, maskToken } from '../../utils/debug';
import {
  waitForRateLimit,
  reportRateLimitSuccess,
  reportRateLimitError,
  configureGlobalRateLimit,
  getRetryDecision,
  getRateLimitStatus,
} from '../provider/rateLimit';

interface ExploreLog {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  resultPreview?: string;
}

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return unwrapOptional(schema.unwrap());
  }
  if (schema instanceof z.ZodEffects) {
    const inner = unwrapOptional(schema.innerType());
    return inner === schema.innerType() ? schema : new z.ZodEffects({
      ...schema._def,
      schema: inner,
    });
  }
  return schema;
}

function makeAllPropertiesRequired(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) {
    const innerTransformed = makeAllPropertiesRequired(schema.innerType());
    return new z.ZodEffects({
      ...schema._def,
      schema: innerTransformed,
    });
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape: Record<string, z.ZodTypeAny> = {};
    for (const key in shape) {
      let fieldSchema = shape[key];
      fieldSchema = unwrapOptional(fieldSchema);
      if (fieldSchema instanceof z.ZodObject) {
        fieldSchema = makeAllPropertiesRequired(fieldSchema);
      } else if (fieldSchema instanceof z.ZodArray) {
        const innerType = fieldSchema.element;
        if (innerType instanceof z.ZodObject) {
          fieldSchema = z.array(makeAllPropertiesRequired(innerType));
        }
      } else if (fieldSchema instanceof z.ZodEffects) {
        const innerType = fieldSchema.innerType();
        if (innerType instanceof z.ZodObject) {
          fieldSchema = new z.ZodEffects({
            ...fieldSchema._def,
            schema: makeAllPropertiesRequired(innerType),
          });
        }
      }
      newShape[key] = fieldSchema;
    }
    return z.object(newShape);
  }
  return schema;
}

function transformToolsForResponsesApi(
  tools: Record<string, CoreTool> | undefined
): Record<string, CoreTool> | undefined {
  if (!tools) return tools;

  const transformed: Record<string, CoreTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as any;
    if (t.parameters) {
      transformed[name] = {
        ...t,
        parameters: makeAllPropertiesRequired(t.parameters),
      };
    } else {
      transformed[name] = tool;
    }
  }
  return transformed;
}

let exploreLogs: ExploreLog[] = [];

const EXPLORE_TIMEOUT = 8 * 60 * 1000;
const EXPLORE_RATE_LIMIT_KEY = 'explore';
const MAX_EXPLORE_RETRIES = 5;
const EXPLORE_RETRY_BASE_DELAY_MS = 2000;

const EXPLORE_TOOL_BUDGET = 40;
let exploreToolBudget = EXPLORE_TOOL_BUDGET;
let exploreCallCache: Map<string, string> = new Map();

function makeCallSignature(tool: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort().reduce((acc, k) => {
    acc[k] = args[k];
    return acc;
  }, {} as Record<string, unknown>);
  return `${tool}::${JSON.stringify(sorted)}`;
}

function describeToolCall(log: ExploreLog): string {
  const t = log.tool;
  const a = log.args;
  if (t === 'read') return a.path as string || '?';
  if (t === 'glob') return `${a.pattern}${a.path && a.path !== '.' ? ' in ' + a.path : ''}`;
  if (t === 'grep') return `"${a.query}"${a.pattern ? ' in ' + a.pattern : ''}`;
  if (t === 'list') return a.path as string || '.';
  if (t === 'fetch') return a.url as string || '?';
  if (t === 'search') return `"${a.query}"`;
  return Object.values(a).filter(Boolean).join(', ');
}

function getExploreMemorySummary(): string {
  if (exploreLogs.length === 0) return '';
  const lines = [`CALLS ALREADY DONE (${exploreLogs.length} calls, budget: ${exploreToolBudget}/${EXPLORE_TOOL_BUDGET}):`];
  for (const log of exploreLogs) {
    const desc = describeToolCall(log);
    lines.push(`  ${log.tool}(${desc}): ${log.resultPreview || 'ok'}`);
  }
  if (exploreToolBudget <= 5) {
    lines.push('Budget almost exhausted. Call "done" NOW with your findings.');
  }
  return lines.join('\n');
}

configureGlobalRateLimit(EXPLORE_RATE_LIMIT_KEY, {
  requestsPerMinute: 30,
  requestsPerSecond: 2,
  burstLimit: 5,
  cooldownMultiplier: 2,
});

const EXPLORE_SYSTEM_PROMPT = `You are an exploration agent that gathers information from a codebase and the web.

Your goal is to explore the codebase and external documentation to fulfill the given purpose. You have access to these tools:
- read: Read file contents
- glob: Find files by pattern
- grep: Search for text in files
- list: List directory contents
- fetch: Fetch a URL and return its content as markdown (for reading documentation pages, API docs, etc.)
- search: Search the web for documentation, tutorials, API references, error solutions

# PARALLEL TOOL EXECUTION - CRITICAL

When you need to perform multiple independent operations, ALWAYS call multiple tools in a SINGLE response. Do NOT wait for one tool to complete before calling another if they are independent.

PARALLEL EXECUTION RULES:
1. Call multiple tools simultaneously when operations are independent (e.g., reading different files, searching different patterns, fetching multiple URLs)
2. Batch related operations together - if you need to read 3 files, call read 3 times in the SAME response
3. Combine different tool types - you can call glob + grep + fetch + list all at once
4. Only wait for results when the next operation depends on a previous result

Examples of GOOD parallel usage:
- Need to read src/auth.ts, src/user.ts, src/api.ts -> call read 3 times in one response
- Need to search for "authentication" AND "authorization" -> call grep 2 times in one response  
- Need to fetch React docs AND Vue docs -> call fetch 2 times in one response
- Need to glob for *.ts AND grep for "import" -> call both in one response

Examples of BAD sequential usage:
- Call read(src/auth.ts) -> wait -> call read(src/user.ts) -> wait -> call read(src/api.ts)
- Call glob(**/*.ts) -> wait -> call grep for each file individually

EFFICIENCY PRIORITY:
- The more tools you can batch together, the faster the exploration completes
- Prefer calling 5-10 tools at once over individual calls when possible
- The system handles parallel execution efficiently - use it!

# STANDARD RULES
1. Be thorough but efficient - don't repeat the same searches
2. When you have gathered enough information to answer the purpose, call the "done" tool with a comprehensive summary
3. If you cannot find the information after reasonable exploration, call "done" with what you found
4. Focus on the purpose - don't explore unrelated areas
5. Summarize findings clearly and include relevant file paths and code snippets
6. You MUST call the "done" tool when finished - this is the only way to complete the exploration
7. When the purpose involves understanding a library, framework, or external API, use search to find official documentation, then fetch to read the relevant pages
8. Prefer official documentation over blog posts or Stack Overflow when possible
9. If search is unavailable, you can still use fetch with known documentation URLs

# NO DUPLICATE CALLS - ENFORCED
NEVER call the same tool with identical parameters twice. The system will BLOCK duplicate calls and return the cached result.
If you receive a "[DUPLICATE BLOCKED]" response, do NOT retry - move on to the next step.

# TOOL BUDGET - ENFORCED
You have a STRICT budget of ${EXPLORE_TOOL_BUDGET} tool calls per exploration. Each tool call (except "done") decrements the budget.
When the budget reaches 0, you MUST call "done" immediately with whatever findings you have.
Plan your exploration efficiently: prefer grep over read when searching, batch parallel calls, and call "done" as soon as you have enough information.`;

const MAX_STEPS = 50;

interface ExploreResult {
  success: boolean;
  result?: string;
  error?: string;
}

interface OAuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

let currentOAuthState: OAuthState | null = null;
let currentGoogleOAuthState: OAuthState | null = null;
let exploreSystemPromptForOAuth: string | null = null;

async function refreshOAuthIfNeeded(): Promise<OAuthState | null> {
  if (!currentOAuthState?.refreshToken) return currentOAuthState;
  if (currentOAuthState.expiresAt && Date.now() < currentOAuthState.expiresAt - 60000) return currentOAuthState;
  const refreshed = await refreshOpenAIOAuthToken(currentOAuthState.refreshToken);
  if (!refreshed) return currentOAuthState;
  currentOAuthState = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    tokenType: refreshed.tokenType,
    scope: refreshed.scope,
  };
  setOAuthTokenForProvider('openai', {
    accessToken: currentOAuthState.accessToken,
    refreshToken: currentOAuthState.refreshToken,
    expiresAt: currentOAuthState.expiresAt,
    tokenType: currentOAuthState.tokenType,
    scope: currentOAuthState.scope,
  });
  return currentOAuthState;
}

async function refreshGoogleOAuthIfNeeded(force = false): Promise<OAuthState | null> {
  if (!currentGoogleOAuthState?.refreshToken) return currentGoogleOAuthState;
  if (!force && currentGoogleOAuthState.expiresAt && Date.now() < currentGoogleOAuthState.expiresAt - 60000) return currentGoogleOAuthState;
  if (force) {
    debugLog(`[oauth][explore][google] force refresh requested, invalidating current token`);
    if (currentGoogleOAuthState.expiresAt) {
      currentGoogleOAuthState = { ...currentGoogleOAuthState, expiresAt: 0 };
    }
  }
  const refreshed = await refreshGoogleOAuthToken(currentGoogleOAuthState.refreshToken!);
  if (!refreshed) {
    debugLog(`[oauth][explore][google] refresh returned null, token may be permanently invalid`);
    return currentGoogleOAuthState;
  }
  currentGoogleOAuthState = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    tokenType: refreshed.tokenType,
    scope: refreshed.scope,
  };
  setOAuthTokenForProvider('google', {
    accessToken: currentGoogleOAuthState.accessToken,
    refreshToken: currentGoogleOAuthState.refreshToken,
    expiresAt: currentGoogleOAuthState.expiresAt,
    tokenType: currentGoogleOAuthState.tokenType,
    scope: currentGoogleOAuthState.scope,
  });
  return currentGoogleOAuthState;
}

const fetchWithOAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const active = await refreshOAuthIfNeeded();
  const accessToken = active?.accessToken;
  const tokenPayload = accessToken ? decodeJwt(accessToken) : null;
  const accountId = typeof tokenPayload?.chatgpt_account_id === 'string'
    ? tokenPayload.chatgpt_account_id
    : undefined;

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }
  headers.delete('authorization');
  headers.delete('Authorization');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('OpenAI-Beta', 'responses=experimental');
  headers.set('originator', 'codex_cli_rs');
  if (accountId) headers.set('chatgpt-account-id', accountId);

  let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
  const originalUrl = url;
  if (url.includes('/v1/responses')) {
    url = url.replace('/v1/responses', '/codex/responses');
  } else if (!url.includes('/codex/responses')) {
    url = url.replace('/responses', '/codex/responses');
  }

  let nextInit: RequestInit = {
    ...init,
    headers,
  };

  const method = (nextInit.method || (input instanceof Request ? input.method : 'GET')).toString().toUpperCase();
  if (method === 'POST') {
    const contentType = headers.get('content-type') ?? '';
    let bodyText: string | undefined;
    if (typeof nextInit.body === 'string') {
      bodyText = nextInit.body;
    } else if (nextInit.body instanceof Uint8Array) {
      bodyText = new TextDecoder().decode(nextInit.body);
    } else if (nextInit.body instanceof ArrayBuffer) {
      bodyText = new TextDecoder().decode(new Uint8Array(nextInit.body));
    }
    if (bodyText && (contentType.includes('application/json') || bodyText.trim().startsWith('{'))) {
      try {
        const json = JSON.parse(bodyText);
        let modified = false;
        if (json.store !== false) {
          json.store = false;
          modified = true;
        }
        if (!json.instructions && exploreSystemPromptForOAuth) {
          json.instructions = exploreSystemPromptForOAuth;
          modified = true;
        }
        if (modified) {
          nextInit = { ...nextInit, body: JSON.stringify(json) };
          headers.set('content-type', 'application/json');
        }
      } catch { }
    }
  }
  debugLog(`[oauth][explore] ${method} ${originalUrl} -> ${url} token=${maskToken(accessToken)} account=${accountId ?? ''}`);
  const res = await fetch(url, nextInit);
  if (!res.ok) {
    const text = await res.clone().text();
    debugLog(`[oauth][explore] ${method} ${url} status=${res.status} body=${text.slice(0, 500)}`);
  }
  return res;
};

const GOOGLE_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const GOOGLE_CODE_ASSIST_VERSION = 'v1internal';
let cachedGoogleProjectId: string | null = null;

const GOOGLE_CLIENT_METADATA = {
  ideType: 'GEMINI_CLI',
  pluginType: 'GEMINI',
};

async function discoverGoogleProjectId(accessToken: string): Promise<string> {
  if (cachedGoogleProjectId) return cachedGoogleProjectId;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  const loadRes = await fetch(`${GOOGLE_CODE_ASSIST_ENDPOINT}/${GOOGLE_CODE_ASSIST_VERSION}:loadCodeAssist`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      metadata: { ...GOOGLE_CLIENT_METADATA, duetProject: 'default-project' },
    }),
  });
  if (!loadRes.ok) {
    const text = await loadRes.text();
    debugLog(`[oauth][explore][google] loadCodeAssist failed status=${loadRes.status} body=${text.slice(0, 500)}`);
    throw new Error(`Google Code Assist loadCodeAssist failed (${loadRes.status})`);
  }
  const loadData = await loadRes.json() as { cloudaicompanionProject?: string | null };
  if (loadData.cloudaicompanionProject) {
    cachedGoogleProjectId = loadData.cloudaicompanionProject;
    debugLog(`[oauth][explore][google] discovered projectId=${cachedGoogleProjectId}`);
    return cachedGoogleProjectId;
  }

  debugLog('[oauth][explore][google] no project, starting onboarding...');
  const onboardRes = await fetch(`${GOOGLE_CODE_ASSIST_ENDPOINT}/${GOOGLE_CODE_ASSIST_VERSION}:onboardUser`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tierId: 'free-tier', metadata: GOOGLE_CLIENT_METADATA }),
  });
  if (!onboardRes.ok) {
    throw new Error(`Google Code Assist onboarding failed (${onboardRes.status})`);
  }
  const lro = await onboardRes.json() as { name?: string; done?: boolean; response?: { cloudaicompanionProject?: { id?: string } } };

  if (lro.done && lro.response?.cloudaicompanionProject?.id) {
    cachedGoogleProjectId = lro.response.cloudaicompanionProject.id;
    return cachedGoogleProjectId;
  }

  if (lro.name) {
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(`${GOOGLE_CODE_ASSIST_ENDPOINT}/${GOOGLE_CODE_ASSIST_VERSION}/${lro.name}`, {
        method: 'GET',
        headers,
      });
      if (!pollRes.ok) break;
      const op = await pollRes.json() as typeof lro;
      if (op.done) {
        if (op.response?.cloudaicompanionProject?.id) {
          cachedGoogleProjectId = op.response.cloudaicompanionProject.id;
          return cachedGoogleProjectId;
        }
        break;
      }
    }
  }

  throw new Error('Google Code Assist onboarding timed out.');
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

type ExploreThoughtSignatureEntry = { toolName: string; argsJson: string; thoughtSignature: string };
let exploreThoughtSignatures: ExploreThoughtSignatureEntry[] = [];
const MAX_EXPLORE_THOUGHT_SIGNATURES = 512;

function extractExploreThoughtSignatures(payload: any): ExploreThoughtSignatureEntry[] {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return [];

  const out: ExploreThoughtSignatureEntry[] = [];
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

function mergeExploreThoughtSignatures(entries: ExploreThoughtSignatureEntry[]): number {
  if (entries.length === 0) return 0;
  exploreThoughtSignatures.push(...entries);
  if (exploreThoughtSignatures.length > MAX_EXPLORE_THOUGHT_SIGNATURES) {
    exploreThoughtSignatures = exploreThoughtSignatures.slice(-MAX_EXPLORE_THOUGHT_SIGNATURES);
  }
  return entries.length;
}

function injectExploreThoughtSignatures(requestBody: any): { injected: number; total: number; missing: number } {
  const contents = requestBody?.contents;
  if (!Array.isArray(contents)) {
    return { injected: 0, total: 0, missing: 0 };
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

  if (modelFunctionCalls.length === 0 || exploreThoughtSignatures.length === 0) {
    const missing = modelFunctionCalls.reduce((acc, call) => {
      return acc + ((typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) ? 0 : 1);
    }, 0);
    return { injected: 0, total: modelFunctionCalls.length, missing };
  }

  const used = new Set<number>();
  let injected = 0;
  const unresolved: Array<{ part: any; toolName: string }> = [];

  for (let i = modelFunctionCalls.length - 1; i >= 0; i--) {
    const call = modelFunctionCalls[i]!;
    if (typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) continue;

    let index = -1;
    for (let j = exploreThoughtSignatures.length - 1; j >= 0; j--) {
      if (used.has(j)) continue;
      const entry = exploreThoughtSignatures[j]!;
      if (entry.toolName === call.toolName && entry.argsJson === call.argsJson) {
        index = j;
        break;
      }
    }

    if (index < 0) {
      unresolved.push({ part: call.part, toolName: call.toolName });
      continue;
    }

    call.part.thoughtSignature = exploreThoughtSignatures[index]!.thoughtSignature;
    used.add(index);
    injected++;
  }

  for (let i = unresolved.length - 1; i >= 0; i--) {
    const pending = unresolved[i]!;
    if (typeof pending.part.thoughtSignature === 'string' && pending.part.thoughtSignature.length > 0) continue;
    let index = -1;
    for (let j = exploreThoughtSignatures.length - 1; j >= 0; j--) {
      if (used.has(j)) continue;
      if (exploreThoughtSignatures[j]!.toolName === pending.toolName) {
        index = j;
        break;
      }
    }
    if (index < 0) continue;
    pending.part.thoughtSignature = exploreThoughtSignatures[index]!.thoughtSignature;
    used.add(index);
    injected++;
  }

  const missing = modelFunctionCalls.reduce((acc, call) => {
    return acc + ((typeof call.part.thoughtSignature === 'string' && call.part.thoughtSignature.length > 0) ? 0 : 1);
  }, 0);
  return { injected, total: modelFunctionCalls.length, missing };
}

const GOOGLE_QUOTA_MIN_DELAY = 2000;
const GOOGLE_QUOTA_MAX_DELAY = 120000;
const GOOGLE_QUOTA_MAX_RETRIES = 10;

function parseGoogleQuotaResetDelay(body: string): number {
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
    return Math.min(GOOGLE_QUOTA_MAX_DELAY, Math.max(GOOGLE_QUOTA_MIN_DELAY, delay));
  } catch {
    return GOOGLE_QUOTA_MIN_DELAY;
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

function unwrapExploreCodeAssistSSE(originalRes: Response): Response {
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
            debugLog(`[oauth][explore][google] first SSE event: ${jsonStr.slice(0, 500)}`);
            firstEventLogged = true;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const payload = parsed.response && !parsed.candidates ? parsed.response : parsed;
            const extracted = extractExploreThoughtSignatures(payload);
            if (extracted.length > 0) {
              const added = mergeExploreThoughtSignatures(extracted);
              debugLog(`[oauth][explore][google] captured thoughtSignature for ${extracted.length} function call(s), added=${added}, cache=${exploreThoughtSignatures.length}`);
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

const fetchWithGoogleOAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const active = await refreshGoogleOAuthIfNeeded();
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

  let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());

  const modelMatch = url.match(/\/models\/([^/:]+)/);
  const actionMatch = url.match(/:([a-zA-Z]+)(?:\?|$)/);
  const model = modelMatch?.[1];
  const action = actionMatch?.[1];

  if (model && action) {
    const projectId = await discoverGoogleProjectId(accessToken!);
    const targetUrl = `${GOOGLE_CODE_ASSIST_ENDPOINT}/${GOOGLE_CODE_ASSIST_VERSION}:${action}?alt=sse`;

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
        if (action === 'streamGenerateContent') {
          const injection = injectExploreThoughtSignatures(originalBody);
          if (injection.total > 0) {
            debugLog(`[oauth][explore][google] thoughtSignature injection injected=${injection.injected} total=${injection.total} missing=${injection.missing} cache=${exploreThoughtSignatures.length}`);
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

    debugLog(`[oauth][explore][google] ${init?.method ?? 'POST'} ${url} -> ${targetUrl} model=${model} project=${projectId} token=${maskToken(accessToken)}`);

    let auth401Retries = 0;
    const MAX_AUTH_RETRIES = 2;

    for (let fetchAttempt = 0; ; fetchAttempt++) {
      const res = await fetch(targetUrl, { ...init, headers, body: wrappedBody });

      if (res.status === 429 && fetchAttempt < GOOGLE_QUOTA_MAX_RETRIES) {
        const text = await res.text();
        const delay = parseGoogleQuotaResetDelay(text);
        debugLog(`[oauth][explore][google] quota exhausted (attempt ${fetchAttempt + 1}/${GOOGLE_QUOTA_MAX_RETRIES}), waiting ${delay}ms | body=${text.slice(0, 300)}`);

        await sleepWithSignal(delay, init?.signal);
        if (init?.signal?.aborted) return res;

        const refreshed = await refreshGoogleOAuthIfNeeded();
        if (refreshed?.accessToken) {
          headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
        }
        continue;
      }

      if ((res.status === 401 || res.status === 403) && auth401Retries < MAX_AUTH_RETRIES) {
        const text = await res.text();
        auth401Retries++;
        debugLog(`[oauth][explore][google] auth error ${res.status} (attempt ${auth401Retries}/${MAX_AUTH_RETRIES}) | body=${text.slice(0, 300)}`);
        cachedGoogleProjectId = null;

        await sleepWithSignal(1000 * auth401Retries, init?.signal);
        if (init?.signal?.aborted) return res;

        const refreshed = await refreshGoogleOAuthIfNeeded(true);
        if (!refreshed?.accessToken) {
          debugLog(`[oauth][explore][google] force refresh failed after ${res.status}, cannot recover`);
          return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
        }

        headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
        try {
          const newProjectId = await discoverGoogleProjectId(refreshed.accessToken);
          if (bodyText) {
            try {
              const originalBody = JSON.parse(bodyText);
              wrappedBody = JSON.stringify({ model, project: newProjectId, request: originalBody });
            } catch { }
          }
        } catch (projErr) {
          debugLog(`[oauth][explore][google] project re-discovery failed after auth retry: ${projErr instanceof Error ? projErr.message : projErr}`);
        }
        continue;
      }

      if (!res.ok) {
        const text = await res.clone().text();
        debugLog(`[oauth][explore][google] ${targetUrl} status=${res.status} body=${text.slice(0, 500)}`);
      }
      if (res.ok && res.body && action === 'streamGenerateContent') {
        return unwrapExploreCodeAssistSSE(res);
      }
      return res;
    }
  }

  debugLog(`[oauth][explore][google] passthrough ${init?.method ?? 'GET'} ${url} token=${maskToken(accessToken)}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.clone().text();
    debugLog(`[oauth][explore][google] ${url} status=${res.status} body=${text.slice(0, 500)}`);
  }
  return res;
};

type ExploreEndpoint = 'responses' | 'chat';

function createModelProvider(config: { provider: string; model: string; apiKey?: string }, endpoint?: ExploreEndpoint) {
  const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
  let cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

  const auth = getAuthForProvider(config.provider);
  const isOAuth = auth?.type === 'oauth';

  if (isOAuth && config.provider === 'openai') {
    cleanModel = mapModelForOAuth(cleanModel);
    currentOAuthState = {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: auth.expiresAt,
      tokenType: auth.tokenType,
      scope: auth.scope,
    };
  } else {
    currentOAuthState = null;
  }

  if (isOAuth && config.provider === 'google') {
    currentGoogleOAuthState = {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: auth.expiresAt,
      tokenType: auth.tokenType,
      scope: auth.scope,
    };
  } else {
    currentGoogleOAuthState = null;
  }

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: cleanApiKey });
      return anthropic(cleanModel);
    }
    case 'openai': {
      if (isOAuth) {
        const openai = createOpenAI({
          apiKey: 'oauth',
          baseURL: 'https://chatgpt.com/backend-api',
          fetch: fetchWithOAuth as typeof fetch,
          compatibility: 'compatible',
        });
        const ep = endpoint ?? 'responses';
        return ep === 'chat' ? openai.chat(cleanModel) : openai.responses(cleanModel);
      }
      const openai = createOpenAI({ apiKey: cleanApiKey });
      return openai(cleanModel);
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey: cleanApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        compatibility: 'compatible',
        name: 'openrouter',
        headers: {
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'mosaic',
        },
      });
      return openrouter(cleanModel);
    }
    case 'google': {
      if (isOAuth) {
        const google = createGoogleGenerativeAI({
          apiKey: 'oauth',
          fetch: fetchWithGoogleOAuth as typeof fetch,
        });
        return google(cleanModel);
      }
      const google = createGoogleGenerativeAI({ apiKey: cleanApiKey });
      return google(cleanModel);
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey: cleanApiKey });
      return mistral(cleanModel);
    }
    case 'xai': {
      const xai = createXai({ apiKey: cleanApiKey });
      return xai(cleanModel);
    }
    case 'ollama': {
      const isCloud = cleanModel.endsWith(':cloud') || cleanModel.endsWith('-cloud') || cleanModel.includes(':cloud') || cleanModel.includes('-cloud');
      const ollamaBaseURL = isCloud && cleanApiKey
        ? 'https://ollama.com/v1'
        : 'http://localhost:11434/v1';
      let ollamaModel = cleanModel;
      if (isCloud) {
        if (ollamaModel.endsWith(':cloud')) ollamaModel = ollamaModel.slice(0, -':cloud'.length);
        else if (ollamaModel.endsWith('-cloud')) ollamaModel = ollamaModel.slice(0, -'-cloud'.length);
      }
      const ollamaOpenAI = createOpenAI({
        apiKey: cleanApiKey || 'ollama',
        baseURL: ollamaBaseURL,
        compatibility: 'compatible',
      });
      return ollamaOpenAI(ollamaModel);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

let exploreDoneResult: string | null = null;

function createExploreTools() {
  return {
    read: createTool({
      description: 'Read the contents of a file',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('read', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already called read(${args.path}). Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        const result = await executeTool('read', args);
        const resultLen = result.result?.length || 0;
        const preview = result.success ? `${(result.result || '').split('\n').length} lines` : (result.error || 'error');
        exploreLogs.push({ tool: 'read', args, success: result.success, resultPreview: preview });
        exploreCallCache.set(sig, preview);
        notifyExploreTool('read', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    glob: createTool({
      description: 'Find files matching a glob pattern. Do NOT use this to list directory contents (use "list" instead).',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")'),
        path: z.string().describe('Directory to search in (use "." for workspace root)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('glob', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already called glob(${args.pattern}). Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        const result = await executeTool('glob', args);
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const files = JSON.parse(result.result);
            const count = Array.isArray(files) ? files.length : 0;
            const sample = Array.isArray(files) ? files.slice(0, 3).join(', ') : '';
            preview = count === 0 ? 'no files' : `${count} files (${sample}${count > 3 ? '...' : ''})`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'glob', args, success: result.success, resultPreview: preview });
        exploreCallCache.set(sig, preview);
        notifyExploreTool('glob', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    grep: createTool({
      description: 'Search for text content within files using regular expressions',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
        query: z.string().describe('Regular expression pattern to search for'),
        path: z.string().describe('Directory to search in (use "." for workspace root)'),
        case_sensitive: z.boolean().describe('Case-sensitive search (pass false for default)'),
        max_results: z.number().describe('Maximum results (pass 50 for default)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('grep', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already called grep(${args.query}). Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        const result = await executeTool('grep', { ...args, regex: true });
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const matches = JSON.parse(result.result);
            const count = Array.isArray(matches) ? matches.length : 0;
            const fileSet = new Set<string>();
            if (Array.isArray(matches)) { for (const m of matches) { const f = (m as any)?.file || (m as any)?.path || ''; if (f) fileSet.add(f); } }
            const files = Array.from(fileSet).slice(0, 3);
            preview = count === 0 ? 'no matches' : `${count} matches in ${files.join(', ')}${files.length > 3 ? '...' : ''}`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'grep', args, success: result.success, resultPreview: preview });
        exploreCallCache.set(sig, preview);
        notifyExploreTool('grep', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    list: createTool({
      description: 'List files and directories',
      parameters: z.object({
        path: z.string().describe('Path to list'),
        recursive: z.boolean().describe('List recursively (pass false for default)'),
        filter: z.string().describe('Filter pattern (pass empty string for no filter)'),
        include_hidden: z.boolean().describe('Include hidden files (pass false for default)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('list', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already called list(${args.path}). Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        const result = await executeTool('list', args);
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const items = JSON.parse(result.result);
            const count = Array.isArray(items) ? items.length : 0;
            const sample = Array.isArray(items) ? items.slice(0, 5).map((i: any) => typeof i === 'string' ? i : i.name || '').join(', ') : '';
            preview = count === 0 ? 'empty' : `${count} items (${sample}${count > 5 ? '...' : ''})`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'list', args, success: result.success, resultPreview: preview });
        exploreCallCache.set(sig, preview);
        notifyExploreTool('list', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    fetch: createTool({
      description: 'Fetch a URL and return its content as markdown. Use this to read documentation pages, API references, tutorials, etc.',
      parameters: z.object({
        url: z.string().describe('The URL to fetch (must be a valid HTTP/HTTPS URL)'),
        max_length: z.number().optional().describe('Maximum characters to return (default: 10000, max: 100000)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('fetch', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already fetched ${args.url}. Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        const result = await executeTool('fetch', { ...args, max_length: args.max_length ?? 10000 });
        const resultLen = result.result?.length || 0;
        const preview = result.success ? `${resultLen} chars` : (result.error || 'error');
        exploreLogs.push({ tool: 'fetch', args, success: result.success, resultPreview: preview });
        exploreCallCache.set(sig, preview);
        notifyExploreTool('fetch', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    search: createTool({
      description: 'Search the web and return top results. Use this to find documentation, API references, tutorials, or solutions to errors.',
      parameters: z.object({
        query: z.string().describe('Search query'),
        engine: z.enum(['google', 'bing', 'duckduckgo']).optional().describe('Search engine to use (default: google)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const sig = makeCallSignature('search', args);
        const cached = exploreCallCache.get(sig);
        if (cached) {
          return `[DUPLICATE BLOCKED] Already searched "${args.query}". Cached result: ${cached}`;
        }
        if (exploreToolBudget <= 0) {
          return { error: 'Tool budget exhausted. Call "done" now.' };
        }
        exploreToolBudget--;
        try {
          const { getMcpManager, isMcpInitialized } = require('../../mcp/index');
          if (!isMcpInitialized()) {
            return { error: 'Web search unavailable (MCP not initialized)' };
          }
          const pm = getMcpManager();
          const callArgs = { query: args.query, engine: args.engine || 'google' };
          const result = await pm.callTool('nativesearch', 'nativesearch_search', callArgs);
          const resultLen = result.content?.length || 0;
          const preview = result.isError ? (result.content || 'error') : `${resultLen} chars`;
          exploreLogs.push({ tool: 'search', args: callArgs, success: !result.isError, resultPreview: preview });
          exploreCallCache.set(sig, preview);
          notifyExploreTool('search', callArgs, { success: !result.isError, preview }, resultLen);
          if (result.isError) return { error: result.content || 'Search failed' };
          return result.content;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          exploreLogs.push({ tool: 'search', args, success: false, resultPreview: message });
          notifyExploreTool('search', args, { success: false, preview: message }, 0);
          return { error: `Web search failed: ${message}` };
        }
      },
    }),
    done: createTool({
      description: 'Call this when you have gathered enough information OR when the budget is exhausted. Provide a comprehensive summary of your findings. This MUST be called to complete the exploration.',
      parameters: z.object({
        summary: z.string().describe('Comprehensive summary of what was found during exploration'),
      }),
      execute: async (args) => {
        exploreDoneResult = args.summary;
        return { done: true, summary: args.summary };
      },
    }),
  };
}

function formatExploreLogs(): string {
  if (exploreLogs.length === 0) return '';

  const lines: string[] = [];
  for (const log of exploreLogs) {
    const desc = describeToolCall(log);
    const status = log.success ? '➔' : 'X';
    lines.push(`  ${status} ${log.tool}(${desc}): ${log.resultPreview || 'ok'}`);
  }
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export async function executeExploreTool(purpose: string): Promise<ExploreResult> {
  const startTime = Date.now();
  const userConfig = readConfig();

  if (!userConfig.provider || !userConfig.model) {
    return {
      success: false,
      error: 'No provider or model configured',
    };
  }

  exploreDoneResult = null;
  exploreLogs = [];
  exploreThoughtSignatures = [];
  exploreToolBudget = EXPLORE_TOOL_BUDGET;
  exploreCallCache = new Map();
  debugLog(`[explore] START purpose="${purpose.slice(0, 100)}" provider=${userConfig.provider} model=${userConfig.model}`);

  const abortSignal = getExploreAbortSignal();
  const timeoutId = setTimeout(() => {
    if (!exploreDoneResult) {
      exploreDoneResult = '[Exploration timed out after 8 minutes]';
    }
  }, EXPLORE_TIMEOUT);

  try {
    const tools = createExploreTools();
    const isOpenAI = userConfig.provider === 'openai';
    const toolsToUse = isOpenAI
      ? transformToolsForResponsesApi(tools)
      : tools;

    const parentContext = getExploreContext();
    const systemPrompt = parentContext
      ? `${EXPLORE_SYSTEM_PROMPT}\n\nCONTEXT FROM PARENT CONVERSATION:\n${parentContext}`
      : EXPLORE_SYSTEM_PROMPT;

    exploreSystemPromptForOAuth = systemPrompt;

    const auth = getAuthForProvider(userConfig.provider);
    const isOAuth = auth?.type === 'oauth';
    const isGoogleOAuth = isOAuth && userConfig.provider === 'google';
    const endpoints: ExploreEndpoint[] = (isOpenAI && isOAuth) ? ['responses', 'chat'] : ['responses'];

    let lastError: string | null = null;

    for (const endpoint of endpoints) {
      if (abortSignal?.aborted || isExploreAborted()) break;
      if (exploreDoneResult !== null) break;

      const model = createModelProvider({
        provider: userConfig.provider,
        model: userConfig.model,
        apiKey: userConfig.apiKey,
      }, endpoint);

      let exploreAttempt = 0;
      let endpointFailed = false;

      while (exploreAttempt < MAX_EXPLORE_RETRIES) {
        if (abortSignal?.aborted || isExploreAborted()) break;

        const rateLimitStatus = getRateLimitStatus(EXPLORE_RATE_LIMIT_KEY);
        if (rateLimitStatus.cooldownRemainingMs > 0) {
          debugLog(`[explore] rate limit cooldown active, waiting ${rateLimitStatus.cooldownRemainingMs}ms`);
        }

        const canProceed = await waitForRateLimit(EXPLORE_RATE_LIMIT_KEY, undefined, abortSignal);
        if (!canProceed) {
          debugLog('[explore] rate limit wait aborted');
          break;
        }

        try {
          const oauthSingleToolConstraint = 'Google OAuth constraint: call at most ONE tool per response. Do not batch tool calls. Wait for each tool result before issuing the next tool call.';
          const effectiveSystemPrompt = isGoogleOAuth
            ? `${systemPrompt}\n\n${oauthSingleToolConstraint}`
            : systemPrompt;
          const result = streamText({
            model,
            messages: [
              {
                role: 'user',
                content: `Explore the codebase to: ${purpose}`,
              },
            ],
            system: effectiveSystemPrompt,
            tools: toolsToUse,
            maxSteps: MAX_STEPS,
            abortSignal,
            providerOptions: isOpenAI
              ? { openai: { strictJsonSchema: false } }
              : undefined,
          });

          for await (const chunk of result.fullStream as any) {
            if (isExploreAborted()) {
              break;
            }
            const c: any = chunk;
            if (c.type === 'error') {
              const errorMessage = c.error instanceof Error ? c.error.message : String(c.error);
              const decision = getRetryDecision(c.error);
              if (decision.shouldRetry) {
                lastError = errorMessage;
                throw c.error;
              }
              lastError = errorMessage;
            }
            if (exploreDoneResult !== null) {
              break;
            }
            if (exploreToolBudget <= 0 && exploreDoneResult === null) {
              debugLog(`[explore] budget exhausted, forcing completion\n${getExploreMemorySummary()}`);
              exploreDoneResult = '[Budget exhausted - exploration stopped]';
              break;
            }
          }

          reportRateLimitSuccess(EXPLORE_RATE_LIMIT_KEY);
          endpointFailed = false;
          break;
        } catch (streamError) {
          if (abortSignal?.aborted || isExploreAborted()) break;

          const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
          const isBadRequest = errorMsg.toLowerCase().includes('bad request') || errorMsg.includes('400');

          if (isBadRequest && endpoints.indexOf(endpoint) < endpoints.length - 1) {
            debugLog(`[explore] endpoint=${endpoint} returned Bad Request, falling back to next endpoint`);
            lastError = errorMsg;
            endpointFailed = true;
            break;
          }

          const decision = getRetryDecision(streamError);
          if (!decision.shouldRetry || exploreAttempt >= MAX_EXPLORE_RETRIES - 1) {
            debugLog(`[explore] stream error not retryable or max retries reached | endpoint=${endpoint} attempt=${exploreAttempt + 1}/${MAX_EXPLORE_RETRIES} | error=${errorMsg.slice(0, 150)}`);
            lastError = errorMsg;
            reportRateLimitError(EXPLORE_RATE_LIMIT_KEY, decision.retryAfterMs);
            endpointFailed = true;
            break;
          }

          reportRateLimitError(EXPLORE_RATE_LIMIT_KEY, decision.retryAfterMs);
          const delay = Math.min(60000, EXPLORE_RETRY_BASE_DELAY_MS * Math.pow(2, exploreAttempt));
          debugLog(`[explore] retrying after error | endpoint=${endpoint} attempt=${exploreAttempt + 1}/${MAX_EXPLORE_RETRIES} | delay=${delay}ms`);

          await new Promise(resolve => setTimeout(resolve, delay));
          exploreAttempt += 1;
        }
      }

      if (!endpointFailed) break;
    }

    clearTimeout(timeoutId);
    const duration = formatDuration(Date.now() - startTime);

    if (isExploreAborted()) {
      debugLog(`[explore] logs:\n${formatExploreLogs()}`);
      return {
        success: false,
        error: `Exploration interrupted (${duration})`,
      };
    }

    if (lastError && exploreLogs.length === 0) {
      return {
        success: false,
        error: lastError,
      };
    }

    const logsStr = formatExploreLogs();
    debugLog(`[explore] logs:\n${logsStr}`);

    if (exploreDoneResult !== null) {
      debugLog(`[explore] DONE success toolsUsed=${exploreLogs.length} duration=${duration}`);
      return {
        success: true,
        result: `Completed in ${duration} (${exploreLogs.length} tool calls)\n\n${exploreDoneResult}`,
      };
    }

    return {
      success: true,
      result: `Completed in ${duration} (${exploreLogs.length} tool calls)\n\nExploration completed after ${MAX_STEPS} steps without explicit summary.`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = formatDuration(Date.now() - startTime);
    debugLog(`[explore] logs:\n${formatExploreLogs()}`);

    if (isExploreAborted()) {
      return {
        success: false,
        error: `Exploration interrupted (${duration})`,
      };
    }

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`[explore] ERROR ${errorMsg.slice(0, 150)} duration=${duration} toolsUsed=${exploreLogs.length}`);
    return {
      success: false,
      error: `${errorMsg} (${duration})`,
    };
  }
}
