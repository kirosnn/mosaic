import { Ollama } from 'ollama';
import { spawn } from 'child_process';
import { CoreMessage, CoreTool } from 'ai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { getOllamaThinkFlag, resolveReasoningEnabled } from './reasoningConfig';
import { getErrorSignature, getRetryDecision } from './rateLimit';
import { debugLog } from '../../utils/debug';

let serveStartPromise: Promise<void> | null = null;
const pullPromises = new Map<string, Promise<void>>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TOOL_MARKER_REGEX = /<\s*[|\uFF5C]\s*(tool[_\u2581]calls[_\u2581]begin|tool[_\u2581]call[_\u2581]begin|tool[_\u2581]call[_\u2581]end|tool[_\u2581]calls[_\u2581]end|tool[_\u2581]sep)\s*[|\uFF5C]\s*>/g;

function normalizeUnicodeTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(/\uFF5C/g, '|')
    .replace(/\u2581/g, '_');
}

function stripToolMarkers(text: string): string {
  if (!text) return '';
  return text.replace(TOOL_MARKER_REGEX, '');
}

function normalizeToolMarkers(text: string): string {
  if (!text) return '';
  return normalizeUnicodeTokens(text)
    .replace(/<\s*\|\s*tool_calls_begin\s*\|\s*>/g, '<|tool_calls_begin|>')
    .replace(/<\s*\|\s*tool_call_begin\s*\|\s*>/g, '<|tool_call_begin|>')
    .replace(/<\s*\|\s*tool_call_end\s*\|\s*>/g, '<|tool_call_end|>')
    .replace(/<\s*\|\s*tool_calls_end\s*\|\s*>/g, '<|tool_calls_end|>')
    .replace(/<\s*\|\s*tool_sep\s*\|\s*>/g, '<|tool_sep|>');
}

function isTransientError(error: unknown): boolean {
  const decision = getRetryDecision(error);
  if (decision.shouldRetry) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed') ||
    msg.toLowerCase().includes('socket') ||
    msg.includes('500')
  );
}

async function retry<T>(fn: () => Promise<T>, retries: number, baseDelayMs: number): Promise<T> {
  let lastError: unknown;
  let lastSignature: string | null = null;
  let sameSignatureCount = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= retries || !isTransientError(e)) throw e;
      const signature = getErrorSignature(e);
      if (signature === lastSignature) {
        sameSignatureCount += 1;
      } else {
        lastSignature = signature;
        sameSignatureCount = 0;
      }
      if (sameSignatureCount >= 1) {
        throw e;
      }
      const decision = getRetryDecision(e);
      const delay = decision.retryAfterMs ?? (baseDelayMs * Math.max(1, attempt + 1));
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

function isCloudModel(model: string): boolean {
  return model.endsWith(':cloud') || model.endsWith('-cloud') || model.includes(':cloud') || model.includes('-cloud');
}

function normalizeCloudModelName(model: string): string {
  if (model.endsWith(':cloud')) return model.slice(0, -':cloud'.length);
  if (model.endsWith('-cloud')) return model.slice(0, -'-cloud'.length);
  return model;
}

function createLocalOllamaClient(apiKey?: string): Ollama {
  void apiKey;
  return new Ollama();
}

function createCloudOllamaClient(apiKey: string): Ollama {
  return new Ollama({
    host: 'https://ollama.com',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  } as any);
}

async function ensureOllamaServe(_apiKey?: string): Promise<void> {
  if (serveStartPromise) return serveStartPromise;

  serveStartPromise = (async () => {
    try {
      const child = spawn('ollama', ['serve'], {
        detached: true,
        windowsHide: true,
        env: {
          ...process.env,
        },
        stdio: 'ignore',
      });
      child.unref();
    } catch {
    }

    await sleep(500);
  })();

  return serveStartPromise;
}

async function ollamaVersion(ollamaClient: Ollama): Promise<unknown> {
  const versionFn = (ollamaClient as any)?.version;
  if (typeof versionFn === 'function') {
    return versionFn.call(ollamaClient);
  }

  const host = String((ollamaClient as any)?.host ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const headers = (ollamaClient as any)?.headers ?? {};

  const res = await fetch(`${host}/api/version`, {
    headers,
  } as any);
  if (!res.ok) {
    throw new Error(`Ollama server not reachable (status ${res.status})`);
  }
  return res.json();
}

async function ensureOllamaReachableLocal(ollamaClient: Ollama, apiKey?: string): Promise<void> {
  try {
    await ollamaVersion(ollamaClient);
    return;
  } catch {
  }

  await ensureOllamaServe(apiKey);

  await retry(() => ollamaVersion(ollamaClient), 6, 350);
}

async function ensureOllamaReachableCloud(ollamaClient: Ollama): Promise<void> {
  await retry(() => ollamaVersion(ollamaClient), 2, 400);
}

async function hasLocalModel(ollamaClient: Ollama, model: string): Promise<boolean> {
  try {
    const host = String((ollamaClient as any)?.host ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    const headers = (ollamaClient as any)?.headers ?? {};

    const res = await fetch(`${host}/api/tags`, {
      headers,
    } as any);

    if (!res.ok) {
      return false;
    }

    const data = await res.json();
    const models = ((data as any)?.models ?? []) as Array<Record<string, any>>;
    return models.some((m) => m?.name === model || m?.model === model);
  } catch {
    return false;
  }
}

async function ensureOllamaModelAvailable(ollamaClient: Ollama, model: string): Promise<void> {
  const existing = pullPromises.get(model);
  if (existing) return existing;

  const p = (async () => {
    const alreadyPresent = await hasLocalModel(ollamaClient, model);
    if (alreadyPresent) return;

    const host = String((ollamaClient as any)?.host ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    const headers = (ollamaClient as any)?.headers ?? {};

    const res = await fetch(`${host}/api/pull`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
      }),
    } as any);

    if (!res.ok) {
      throw new Error(`Failed to pull model ${model} (status ${res.status})`);
    }

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    }
  })();

  pullPromises.set(model, p);
  return p;
}

function contentToString(content: CoreMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';

  if (Array.isArray(content)) {
    const text = content
      .map((part: any) => {
        if (part && typeof part.text === 'string') return part.text;
        if (typeof part === 'string') return part;
        return '';
      })
      .filter(Boolean)
      .join('');

    if (text) return text;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function imagePartToBase64(image: any): string | undefined {
  if (!image) return undefined;
  if (typeof image === 'string') return image;
  if (Buffer.isBuffer(image)) return image.toString('base64');
  if (image instanceof Uint8Array) return Buffer.from(image).toString('base64');
  if (image instanceof ArrayBuffer) return Buffer.from(new Uint8Array(image)).toString('base64');
  return undefined;
}

function toOllamaTools(tools?: Record<string, CoreTool>): any[] | undefined {
  if (!tools) return undefined;

  return Object.entries(tools).map(([name, tool]) => {
    const params = (tool as any)?.parameters;
    let jsonSchema: any = { type: 'object', properties: {} };

    if (params) {
      if (params instanceof z.ZodType) {
        const converted = zodToJsonSchema(params, { target: 'openApi3' });
        jsonSchema = converted;
        if ('$schema' in jsonSchema) delete jsonSchema.$schema;
      } else if (typeof params === 'object' && 'type' in params) {
        jsonSchema = params;
      }
    }

    return {
      type: 'function',
      function: {
        name,
        description: String((tool as any)?.description ?? name),
        parameters: jsonSchema,
      },
    };
  });
}

function coreMessagesToOllamaMessages(messages: CoreMessage[]): any[] {
  return messages
    .map((message) => {
      if (message.role === 'tool') {
        const content: any = message.content;
        const part = Array.isArray(content) ? content?.[0] : undefined;
        const toolName = part?.toolName ?? part?.tool_name;
        const result = part?.result;

        if (toolName) {
          return {
            role: 'tool',
            tool_name: String(toolName),
            content:
              typeof result === 'string'
                ? result
                : result == null
                  ? ''
                  : (() => {
                    try {
                      return JSON.stringify(result);
                    } catch {
                      return String(result);
                    }
                  })(),
          };
        }

        return {
          role: 'tool',
          content: contentToString(message.content),
        };
      }

      if (message.role === 'user' && Array.isArray(message.content)) {
        const textParts = message.content
          .map((part: any) => (part && typeof part.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('');
        const images = message.content
          .map((part: any) => (part && part.type === 'image' ? imagePartToBase64(part.image) : undefined))
          .filter(Boolean);
        const msg: any = { role: 'user', content: textParts };
        if (images.length > 0) {
          msg.images = images;
        }
        return msg;
      }

      return {
        role: message.role,
        content: contentToString(message.content),
      };
    })
    .filter(Boolean);
}

const OLLAMA_TOOL_CALLS_BEGIN = '<|tool_calls_begin|>';
const OLLAMA_TOOL_CALL_BEGIN = '<|tool_call_begin|>';
const OLLAMA_TOOL_CALL_END = '<|tool_call_end|>';
const OLLAMA_TOOL_CALLS_END = '<|tool_calls_end|>';
const OLLAMA_TOOL_SEP = '<|tool_sep|>';

type ParsedOllamaToolCalls = {
  reasoning: string;
  content: string;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  hadMarkers: boolean;
};

function mergeText(base: string, next: string): string {
  if (!base) return next;
  if (!next) return base;
  const needsNewline = !base.endsWith('\n') && !next.startsWith('\n');
  return needsNewline ? `${base}\n${next}` : `${base}${next}`;
}

function parseOllamaToolCalls(content: string): ParsedOllamaToolCalls {
  const normalized = normalizeToolMarkers(content);

  const beginIndex = normalized.indexOf(OLLAMA_TOOL_CALLS_BEGIN);
  const altIndex = normalized.indexOf(OLLAMA_TOOL_CALL_BEGIN);
  const startIndex = beginIndex >= 0 ? beginIndex : altIndex;
  if (startIndex === -1) {
    return { reasoning: '', content: stripToolMarkers(content), calls: [], hadMarkers: false };
  }

  const reasoning = normalized.slice(0, startIndex);
  const rest = normalized.slice(startIndex);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let cursor = 0;

  while (true) {
    const callStart = rest.indexOf(OLLAMA_TOOL_CALL_BEGIN, cursor);
    if (callStart === -1) break;
    const nameStart = callStart + OLLAMA_TOOL_CALL_BEGIN.length;
    const sepIndex = rest.indexOf(OLLAMA_TOOL_SEP, nameStart);
    if (sepIndex === -1) break;
    const endIndex = rest.indexOf(OLLAMA_TOOL_CALL_END, sepIndex + OLLAMA_TOOL_SEP.length);
    if (endIndex === -1) break;

    const name = rest.slice(nameStart, sepIndex).trim();
    const argsText = rest.slice(sepIndex + OLLAMA_TOOL_SEP.length, endIndex).trim();
    let args: Record<string, unknown> = {};
    if (argsText) {
      try {
        const parsed = JSON.parse(argsText);
        if (parsed && typeof parsed === 'object') {
          args = parsed as Record<string, unknown>;
        } else {
          args = { input: parsed };
        }
      } catch {
        args = { input: argsText };
      }
    }

    if (name) {
      calls.push({ name, args });
    }

    cursor = endIndex + OLLAMA_TOOL_CALL_END.length;
  }

  let trailing = '';
  const callsEnd = rest.indexOf(OLLAMA_TOOL_CALLS_END, cursor);
  if (callsEnd !== -1) {
    trailing = rest.slice(callsEnd + OLLAMA_TOOL_CALLS_END.length);
  } else if (cursor > 0) {
    trailing = rest.slice(cursor);
  }

  return {
    reasoning: stripToolMarkers(reasoning),
    content: stripToolMarkers(trailing),
    calls,
    hadMarkers: true,
  };
}

export async function checkAndStartOllama(): Promise<{ running: boolean; started: boolean; error?: string }> {
  const ollamaClient = new Ollama();

  try {
    await ollamaVersion(ollamaClient);
    return { running: true, started: false };
  } catch {
  }

  try {
    await ensureOllamaServe();
    await retry(() => ollamaVersion(ollamaClient), 6, 350);
    return { running: true, started: true };
  } catch (e) {
    return {
      running: false,
      started: false,
      error: e instanceof Error ? e.message : 'Failed to start Ollama',
    };
  }
}

export class OllamaProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const apiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);
    const think = getOllamaThinkFlag(reasoningEnabled);
    debugLog(`[ollama] starting stream model=${cleanModel} messagesLen=${messages.length} reasoning=${reasoningEnabled}`);

    if (options?.abortSignal?.aborted) {
      return;
    }

    let ollamaClient: Ollama;
    let requestModel: string;

    if (isCloudModel(cleanModel) && apiKey) {
      ollamaClient = createCloudOllamaClient(apiKey);
      requestModel = normalizeCloudModelName(cleanModel);
      try {
        await ensureOllamaReachableCloud(ollamaClient);
      } catch (cloudError) {
        yield {
          type: 'error',
          error:
            (cloudError instanceof Error ? cloudError.message : 'Failed to reach Ollama cloud API') +
            ' (check your Ollama API key and cloud access).',
        };
        return;
      }
    } else {
      ollamaClient = createLocalOllamaClient(apiKey);
      requestModel = cleanModel;

      try {
        await ensureOllamaReachableLocal(ollamaClient, apiKey);

        const present = await hasLocalModel(ollamaClient, cleanModel);
        if (!present) {
          await ensureOllamaModelAvailable(ollamaClient, cleanModel);
        }
      } catch (localError) {
        if (apiKey) {
          requestModel = normalizeCloudModelName(cleanModel);
          ollamaClient = createCloudOllamaClient(apiKey);

          try {
            await ensureOllamaReachableCloud(ollamaClient);
          } catch (cloudError) {
            yield {
              type: 'error',
              error:
                (cloudError instanceof Error ? cloudError.message : 'Failed to reach Ollama cloud API') +
                ' (check your Ollama API key and cloud access).',
            };
            return;
          }
        } else {
          const hint = isCloudModel(cleanModel)
            ? ' If this is a cloud model, run `ollama signin` then `ollama pull <model>` locally.'
            : '';
          yield {
            type: 'error',
            error:
              (localError instanceof Error ? localError.message : 'Failed to prepare Ollama') +
              ' Ensure the Ollama app/server is running. If needed, install the Ollama CLI and ensure it is available in PATH.' +
              hint,
          };
          return;
        }
      }
    }

    const toolsSchema = toOllamaTools(config.tools);
    const maxSteps = config.maxSteps || 100;
    const shouldBufferForToolCalls = Boolean(toolsSchema);

    const baseMessages = config.systemPrompt
      ? [{ role: 'system' as const, content: config.systemPrompt }, ...messages]
      : messages;

    const ollamaMessages: any[] = coreMessagesToOllamaMessages(baseMessages);

    try {
      for (let stepNumber = 0; stepNumber < maxSteps; stepNumber++) {
        if (options?.abortSignal?.aborted) return;
        yield {
          type: 'step-start',
          stepNumber,
        };

        let assistantContent = '';
        let assistantThinking = '';
        let pendingThinking = '';
        let hasContent = false;
        let contentBuffer = '';
        const toolCalls: any[] = [];
        let rawThinkingBuffer = '';

        const stream = await retry(
          () =>
            ollamaClient.chat({
              model: requestModel,
              messages: ollamaMessages,
              tools: toolsSchema,
              stream: true,
              think,
              signal: options?.abortSignal,
            } as any) as any,
          2,
          500
        );

        for await (const chunk of stream as AsyncGenerator<any>) {
          if (options?.abortSignal?.aborted) return;
          const thinkingDeltaRaw = chunk?.message?.thinking;
          if (typeof thinkingDeltaRaw === 'string' && thinkingDeltaRaw) {
            rawThinkingBuffer += thinkingDeltaRaw;
            if (!shouldBufferForToolCalls) {
              const thinkingDelta = stripToolMarkers(thinkingDeltaRaw);
              assistantThinking += thinkingDelta;
              if (hasContent) {
                yield {
                  type: 'reasoning-delta',
                  content: thinkingDelta,
                };
              } else {
                pendingThinking += thinkingDelta;
              }
            }
          }

          const contentDelta = chunk?.message?.content;
          if (typeof contentDelta === 'string' && contentDelta) {
            if (!hasContent) {
              hasContent = true;
              if (pendingThinking) {
                yield {
                  type: 'reasoning-delta',
                  content: stripToolMarkers(pendingThinking),
                };
                assistantThinking = mergeText(assistantThinking, pendingThinking);
                pendingThinking = '';
              }
            }
            if (shouldBufferForToolCalls) {
              contentBuffer += contentDelta;
            } else {
              assistantContent += contentDelta;
              yield {
                type: 'text-delta',
                content: stripToolMarkers(contentDelta),
              };
            }
          }

          const partialToolCalls = chunk?.message?.tool_calls;
          if (Array.isArray(partialToolCalls) && partialToolCalls.length > 0) {
            toolCalls.push(...partialToolCalls);
          }
        }

        if (shouldBufferForToolCalls && contentBuffer) {
          const parsed = parseOllamaToolCalls(contentBuffer);
          if (parsed.hadMarkers) {
            if (parsed.reasoning.trim()) {
              assistantThinking = mergeText(assistantThinking, parsed.reasoning);
              yield {
                type: 'reasoning-delta',
                content: stripToolMarkers(parsed.reasoning),
              };
            }
            if (parsed.content.trim()) {
              assistantContent += parsed.content;
              yield {
                type: 'text-delta',
                content: stripToolMarkers(parsed.content),
              };
            }
            if (parsed.calls.length > 0 && toolCalls.length === 0) {
              for (const call of parsed.calls) {
                toolCalls.push({
                  function: {
                    name: call.name,
                    arguments: call.args,
                  },
                });
              }
            }
          } else {
            assistantContent += parsed.content;
            if (parsed.content) {
              yield {
                type: 'text-delta',
                content: stripToolMarkers(parsed.content),
              };
            }
          }
          contentBuffer = '';
        }

        if (rawThinkingBuffer) {
          const parsedFromThinking = parseOllamaToolCalls(rawThinkingBuffer);

          if (shouldBufferForToolCalls) {
            const cleanThinking = parsedFromThinking.hadMarkers
              ? parsedFromThinking.reasoning.trim()
              : stripToolMarkers(rawThinkingBuffer).trim();
            if (cleanThinking) {
              assistantThinking = cleanThinking;
              yield {
                type: 'reasoning-delta',
                content: cleanThinking,
              };
            }
          } else if (!hasContent) {
            const cleanThinking = parsedFromThinking.hadMarkers
              ? stripToolMarkers(parsedFromThinking.reasoning)
              : stripToolMarkers(rawThinkingBuffer);
            if (cleanThinking.trim()) {
              yield {
                type: 'reasoning-delta',
                content: cleanThinking,
              };
              assistantThinking = cleanThinking;
            }
            pendingThinking = '';
          }

          if (toolCalls.length === 0 && parsedFromThinking.hadMarkers && parsedFromThinking.calls.length > 0) {
            debugLog(`[ollama] extracted ${parsedFromThinking.calls.length} tool call(s) from thinking content`);
            for (const call of parsedFromThinking.calls) {
              toolCalls.push({
                function: {
                  name: call.name,
                  arguments: call.args,
                },
              });
            }
          }
        } else if (!hasContent && pendingThinking) {
          const cleanThinking = stripToolMarkers(pendingThinking);
          if (cleanThinking.trim()) {
            yield {
              type: 'reasoning-delta',
              content: cleanThinking,
            };
            assistantThinking = cleanThinking;
          }
          pendingThinking = '';
        }

        const assistantMessage: any = {
          role: 'assistant',
          content: assistantContent,
        };

        assistantThinking = stripToolMarkers(assistantThinking);
        pendingThinking = stripToolMarkers(pendingThinking);
        if (assistantThinking) assistantMessage.thinking = assistantThinking;
        if (toolCalls.length) assistantMessage.tool_calls = toolCalls;
        ollamaMessages.push(assistantMessage);

        const normalizedCalls = toolCalls
          .map((c, i) => ({
            index: typeof c?.function?.index === 'number' ? c.function.index : i,
            name: String(c?.function?.name ?? ''),
            arguments: (c?.function?.arguments ?? {}) as Record<string, unknown>,
          }))
          .filter((c) => Boolean(c.name));

        if (normalizedCalls.length > 0 && config.tools && stepNumber < maxSteps - 1) {
          for (let i = 0; i < normalizedCalls.length; i++) {
            if (options?.abortSignal?.aborted) return;
            const call = normalizedCalls[i]!;
            const toolCallId = `ollama-${stepNumber}-${call.index}-${i}`;

            yield {
              type: 'tool-call-end',
              toolCallId,
              toolName: call.name,
              args: call.arguments,
            };

            let toolResult: unknown;
            try {
              const tool: any = (config.tools as any)[call.name];
              if (!tool || typeof tool.execute !== 'function') {
                throw new Error(`Tool not available: ${call.name}`);
              }

              toolResult = await tool.execute(call.arguments);
            } catch (e) {
              toolResult = { error: e instanceof Error ? e.message : 'Tool execution failed' };
            }

            yield {
              type: 'tool-result',
              toolCallId,
              toolName: call.name,
              result: toolResult,
            };

            ollamaMessages.push({
              role: 'tool',
              tool_name: call.name,
              content:
                typeof toolResult === 'string'
                  ? stripToolMarkers(toolResult)
                  : toolResult == null
                    ? ''
                    : (() => {
                      try {
                        return JSON.stringify(toolResult);
                      } catch {
                        return String(toolResult);
                      }
                    })(),
            });
          }

          yield {
            type: 'step-finish',
            stepNumber,
            finishReason: 'tool-calls',
          };
          continue;
        }

        if (!assistantContent && assistantThinking && normalizedCalls.length === 0 && stepNumber < maxSteps - 1) {
          debugLog('[ollama] no text content produced, forcing text response with think=false');
          const textStream = await retry(
            () =>
              ollamaClient.chat({
                model: requestModel,
                messages: ollamaMessages,
                stream: true,
                think: false,
                signal: options?.abortSignal,
              } as any) as any,
            2,
            500
          );

          for await (const chunk of textStream as AsyncGenerator<any>) {
            if (options?.abortSignal?.aborted) return;
            const contentDelta = chunk?.message?.content;
            if (typeof contentDelta === 'string' && contentDelta) {
              assistantContent += contentDelta;
              yield {
                type: 'text-delta',
                content: contentDelta,
              };
            }
          }

          if (assistantContent) {
            ollamaMessages.push({ role: 'assistant', content: assistantContent });
          }
        }

        yield {
          type: 'step-finish',
          stepNumber,
          finishReason: 'stop',
        };
        break;
      }

      yield {
        type: 'finish',
        finishReason: 'stop',
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
