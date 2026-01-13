import { Ollama } from 'ollama';
import { spawn } from 'child_process';
import { CoreMessage, CoreTool } from 'ai';
import { AgentEvent, Provider, ProviderConfig } from '../types';

let serveStartPromise: Promise<void> | null = null;
const pullPromises = new Map<string, Promise<void>>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientError(error: unknown): boolean {
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
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= retries || !isTransientError(e)) throw e;
      await sleep(baseDelayMs * Math.max(1, attempt + 1));
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

async function ensureOllamaServe(apiKey?: string): Promise<void> {
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
      // ignore
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
  const headers = (ollamaClient as any)?.headers ?? undefined;

  const res = await fetch(`${host}/api/version`, {
    headers,
  } as any);
  if (!res.ok) {
    throw new Error(`Ollama version failed with status ${res.status}`);
  }
  return res.json();
}

async function ensureOllamaReachableLocal(ollamaClient: Ollama, apiKey?: string): Promise<void> {
  try {
    await ollamaVersion(ollamaClient);
    return;
  } catch {
    // fallthrough
  }

  await ensureOllamaServe(apiKey);

  await retry(() => ollamaVersion(ollamaClient), 6, 350);
}

async function ensureOllamaReachableCloud(ollamaClient: Ollama): Promise<void> {
  await retry(() => ollamaVersion(ollamaClient), 2, 400);
}

async function hasLocalModel(ollamaClient: Ollama, model: string): Promise<boolean> {
  try {
    const list = await ollamaClient.list();
    const models = ((list as any)?.models ?? []) as Array<Record<string, any>>;
    return models.some((m) => m?.name === model || m?.model === model);
  } catch {
    return false;
  }
}

async function ensureOllamaModelAvailable(ollamaClient: Ollama, model: string): Promise<void> {
  const existing = pullPromises.get(model);
  if (existing) return existing;

  const p = (async () => {
    let alreadyPresent = false;

    try {
      const list = await ollamaClient.list();
      const models = ((list as any)?.models ?? []) as Array<Record<string, any>>;
      alreadyPresent = models.some((m) => m?.name === model || m?.model === model);
    } catch {
      alreadyPresent = false;
    }

    if (alreadyPresent) return;

    const pullResponse: any = await ollamaClient.pull({ model, stream: true } as any);
    if (pullResponse && typeof pullResponse === 'object' && Symbol.asyncIterator in pullResponse) {
      for await (const _ of pullResponse as AsyncGenerator<any>) {
        // drain
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

function toOllamaTools(tools?: Record<string, CoreTool>): any[] | undefined {
  if (!tools) return undefined;

  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: String((tool as any)?.description ?? name),
      parameters: (() => {
        const params = (tool as any)?.parameters;
        if (params && typeof params === 'object' && 'type' in params) return params;
        return { type: 'object', properties: {} };
      })(),
    },
  }));
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

      return {
        role: message.role,
        content: contentToString(message.content),
      };
    })
    .filter(Boolean);
}

export class OllamaProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig
  ): AsyncGenerator<AgentEvent> {
    const apiKey = config.apiKey;

    let ollamaClient: Ollama;
    let requestModel: string;

    if (isCloudModel(config.model) && apiKey) {
      ollamaClient = createCloudOllamaClient(apiKey);
      requestModel = normalizeCloudModelName(config.model);
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
      requestModel = config.model;

      try {
        await ensureOllamaReachableLocal(ollamaClient, apiKey);

        const present = await hasLocalModel(ollamaClient, config.model);
        if (!present) {
          await ensureOllamaModelAvailable(ollamaClient, config.model);
        }
      } catch (localError) {
        if (apiKey) {
          requestModel = normalizeCloudModelName(config.model);
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
          const hint = isCloudModel(config.model)
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
    const maxSteps = config.maxSteps || 10;

    const baseMessages = config.systemPrompt
      ? [{ role: 'system' as const, content: config.systemPrompt }, ...messages]
      : messages;

    const ollamaMessages: any[] = coreMessagesToOllamaMessages(baseMessages);

    try {
      for (let stepNumber = 0; stepNumber < maxSteps; stepNumber++) {
        yield {
          type: 'step-start',
          stepNumber,
        };

        let assistantContent = '';
        let assistantThinking = '';
        const toolCalls: any[] = [];

        const stream = await retry(
          () =>
            ollamaClient.chat({
              model: requestModel,
              messages: ollamaMessages,
              tools: toolsSchema,
              stream: true,
              think: true,
            } as any) as any,
          2,
          500
        );

        for await (const chunk of stream as AsyncGenerator<any>) {
          const thinkingDelta = chunk?.message?.thinking;
          if (typeof thinkingDelta === 'string' && thinkingDelta) {
            assistantThinking += thinkingDelta;
            yield {
              type: 'reasoning-delta',
              content: thinkingDelta,
            };
          }

          const contentDelta = chunk?.message?.content;
          if (typeof contentDelta === 'string' && contentDelta) {
            assistantContent += contentDelta;
            yield {
              type: 'text-delta',
              content: contentDelta,
            };
          }

          const partialToolCalls = chunk?.message?.tool_calls;
          if (Array.isArray(partialToolCalls) && partialToolCalls.length > 0) {
            toolCalls.push(...partialToolCalls);
          }
        }

        const assistantMessage: any = {
          role: 'assistant',
          content: assistantContent,
        };

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
                  ? toolResult
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