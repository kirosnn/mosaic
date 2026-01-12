import { Ollama } from 'ollama';
import { spawn } from 'child_process';
import { CoreMessage } from 'ai';
import { AgentEvent, Provider, ProviderConfig } from '../types';

let serveStarted = false;
const pullPromises = new Map<string, Promise<void>>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isCloudModel(model: string): boolean {
  return model.endsWith(':cloud') || model.endsWith('-cloud') || model.includes(':cloud') || model.includes('-cloud');
}

async function runOllamaCommand(args: string[], apiKey?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ollama', args, {
      windowsHide: true,
      env: {
        ...process.env,
        ...(apiKey ? { OLLAMA_API_KEY: apiKey } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error((stderr || '').trim() || `ollama ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function ensureOllamaServe(apiKey?: string): Promise<void> {
  if (serveStarted) return;
  serveStarted = true;

  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        ...(apiKey ? { OLLAMA_API_KEY: apiKey } : {}),
      },
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // ignore
  }

  await sleep(500);
}

async function ensureOllamaModelPulled(model: string, apiKey?: string): Promise<void> {
  const existing = pullPromises.get(model);
  if (existing) return existing;

  const p = (async () => {
    await ensureOllamaServe(apiKey);
    await runOllamaCommand(['pull', model], apiKey);
  })();

  pullPromises.set(model, p);
  return p;
}

function parsePseudoToolCalls(text: string): Array<{ toolName: string; args: Record<string, unknown> }> {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = line.match(/^(?:\|\s*)?(read_file|write_file|list_files|execute_command)\s+(path|command)\s*:\s*(.+)$/i);
    if (!m) continue;

    const toolName = m[1]!.toLowerCase();
    const key = m[2]!.toLowerCase();
    const value = (m[3] || '').trim();

    if (!value) continue;

    if (toolName === 'list_files' && key === 'path') {
      calls.push({ toolName, args: { path: value } });
    } else if (toolName === 'read_file' && key === 'path') {
      calls.push({ toolName, args: { path: value } });
    } else if (toolName === 'execute_command' && key === 'command') {
      calls.push({ toolName, args: { command: value } });
    }
  }

  return calls;
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

export class OllamaProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig
  ): AsyncGenerator<AgentEvent> {
    const cloud = isCloudModel(config.model);
    const apiKey = config.apiKey;

    try {
      await ensureOllamaModelPulled(config.model, apiKey);
    } catch (error) {
      const keyHint = cloud ? ' (this model may require an API key)' : '';
      yield {
        type: 'error',
        error:
          (error instanceof Error ? error.message : 'Failed to prepare Ollama') +
          `${keyHint}. Ensure the Ollama CLI is installed and available in PATH.`,
      };
      return;
    }

    const ollamaClient = new Ollama(
      (apiKey
        ? ({
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          } as any)
        : undefined) as any
    );

    const finalMessages = config.systemPrompt
      ? [{ role: 'system' as const, content: config.systemPrompt }, ...messages]
      : messages;

    let assistantText = '';

    try {
      const response = await ollamaClient.chat({
        model: config.model,
        messages: finalMessages.map(msg => ({
          role: msg.role,
          content: contentToString(msg.content),
        })),
        stream: true,
      });

      for await (const chunk of response) {
        if (chunk.message?.content) {
          assistantText += chunk.message.content;
          yield {
            type: 'text-delta',
            content: chunk.message.content,
          };
        }
      }

      const pseudoCalls = parsePseudoToolCalls(assistantText);
      if (pseudoCalls.length > 0 && config.tools) {
        for (let i = 0; i < pseudoCalls.length; i++) {
          const call = pseudoCalls[i]!;
          const toolCallId = `pseudo-${Date.now()}-${i}`;

          yield {
            type: 'tool-call-end',
            toolCallId,
            toolName: call.toolName,
            args: call.args,
          };

          try {
            const tool: any = (config.tools as any)[call.toolName];
            if (!tool || typeof tool.execute !== 'function') {
              throw new Error(`Tool not available: ${call.toolName}`);
            }

            const toolResult = await tool.execute(call.args);
            yield {
              type: 'tool-result',
              toolCallId,
              toolName: call.toolName,
              result: toolResult,
            };
          } catch (e) {
            yield {
              type: 'tool-result',
              toolCallId,
              toolName: call.toolName,
              result: { error: e instanceof Error ? e.message : 'Tool execution failed' },
            };
          }
        }
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