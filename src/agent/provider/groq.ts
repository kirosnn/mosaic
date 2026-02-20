import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { CoreMessage, CoreTool } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { normalizeError, runWithRetry } from './rateLimit';
import { debugLog } from '../../utils/debug';
import { StreamSanitizer } from './streamSanitizer';
import { ContextGuard } from './contextGuard';

type GroqToolCallState = {
  index: number;
  id: string;
  name: string;
  args: string;
};

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

function toGroqToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function coreMessageToGroqMessage(message: CoreMessage): ChatCompletionMessageParam | null {
  if (message.role === 'tool') {
    const content: any = message.content;
    const part = Array.isArray(content) ? content[0] : undefined;
    const toolCallId = part?.toolCallId ?? part?.tool_call_id;
    const result = part?.result ?? content;
    return {
      role: 'tool',
      tool_call_id: toolCallId ?? 'tool',
      content: toGroqToolResult(result),
    } as ChatCompletionMessageParam;
  }

  if (message.role === 'assistant' || message.role === 'user' || message.role === 'system') {
    return {
      role: message.role,
      content: contentToString(message.content),
    } as ChatCompletionMessageParam;
  }

  return null;
}

function toGroqMessages(messages: CoreMessage[]): ChatCompletionMessageParam[] {
  return messages
    .map(coreMessageToGroqMessage)
    .filter((message): message is ChatCompletionMessageParam => Boolean(message));
}

function toGroqTools(tools?: Record<string, CoreTool>): ChatCompletionTool[] | undefined {
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
    } as ChatCompletionTool;
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return { input: parsed } as Record<string, unknown>;
  } catch {
    return { input: raw };
  }
}

function mergeToolCallState(
  map: Map<number, GroqToolCallState>,
  call: { index?: number; id?: string; function?: { name?: string; arguments?: string } }
): void {
  const index = typeof call.index === 'number' ? call.index : 0;
  const existing = map.get(index) ?? { index, id: '', name: '', args: '' };
  if (call.id) existing.id = call.id;
  if (call.function?.name) existing.name = call.function.name;
  if (call.function?.arguments) existing.args += call.function.arguments;
  map.set(index, existing);
}

function normalizeToolCalls(map: Map<number, GroqToolCallState>, stepNumber: number): GroqToolCallState[] {
  const ordered = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({ ...value }));

  return ordered
    .map((call, idx) => ({
      ...call,
      id: call.id || `groq-${stepNumber}-${idx}`,
    }))
    .filter(call => call.name.trim());
}

export class GroqProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    debugLog(`[groq] starting stream model=${cleanModel} messagesLen=${messages.length}`);

    const groq = new Groq({ apiKey: cleanApiKey });
    const groqTools = toGroqTools(config.tools);
    const maxSteps = config.maxSteps ?? 100;
    const contextGuard = new ContextGuard(config.maxContextTokens);

    let currentMessages = toGroqMessages(messages);
    if (config.systemPrompt) {
      currentMessages = [{ role: 'system', content: config.systemPrompt }, ...currentMessages];
    }

    try {
      for (let stepNumber = 0; stepNumber < maxSteps; stepNumber++) {
        if (options?.abortSignal?.aborted) return;

        let assistantContent = '';
        let finishReason: string | undefined;
        const toolCallMap = new Map<number, GroqToolCallState>();
        const sanitizer = new StreamSanitizer();

        try {
          yield* runWithRetry(async function* () {
            const stream = await groq.chat.completions.create(
              {
                model: cleanModel,
                messages: currentMessages,
                stream: true,
                tools: groqTools,
                tool_choice: groqTools ? 'auto' : undefined,
                max_tokens: config.maxOutputTokens ?? 16384,
              } as any,
              options?.abortSignal ? { signal: options.abortSignal } as any : undefined
            );

            yield { type: 'step-start', stepNumber };

            for await (const chunk of stream as AsyncGenerator<any>) {
              if (options?.abortSignal?.aborted) return;
              const choice = chunk?.choices?.[0];
              if (!choice) continue;
              if (choice.finish_reason) finishReason = String(choice.finish_reason);

              const delta = choice.delta ?? {};
              if (typeof delta.content === 'string' && delta.content) {
                const safe = sanitizer.feed(delta.content);
                if (safe !== null) {
                  assistantContent += safe;
                  yield { type: 'text-delta', content: safe };
                }
              }

              if (Array.isArray(delta.tool_calls)) {
                for (const call of delta.tool_calls) {
                  mergeToolCallState(toolCallMap, call);
                }
              }
            }
          }, { abortSignal: options?.abortSignal, key: config.provider });
        } catch (error) {
          if (options?.abortSignal?.aborted) return;
          const err = normalizeError(error);
          yield {
            type: 'error',
            error: err.message,
          };
          return;
        }

        const normalizedCalls = normalizeToolCalls(toolCallMap, stepNumber);

        if (normalizedCalls.length > 0 && stepNumber < maxSteps - 1) {
          currentMessages.push({
            role: 'assistant',
            content: assistantContent,
            tool_calls: normalizedCalls.map(call => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: call.args || '{}',
              },
            })),
          } as ChatCompletionMessageParam);
          for (const call of normalizedCalls) {
            if (options?.abortSignal?.aborted) return;
            const parsedArgs = parseToolArguments(call.args);
            yield {
              type: 'tool-call-end',
              toolCallId: call.id,
              toolName: call.name,
              args: parsedArgs,
            };

            let toolResult: unknown;
            try {
              const tool: any = (config.tools as any)?.[call.name];
              if (!tool || typeof tool.execute !== 'function') {
                throw new Error(`Tool not available: ${call.name}`);
              }
              toolResult = await tool.execute(parsedArgs);
            } catch (toolError) {
              toolResult = { error: toolError instanceof Error ? toolError.message : 'Tool execution failed' };
            }

            contextGuard.trackToolResult(toolResult);
            yield {
              type: 'tool-result',
              toolCallId: call.id,
              toolName: call.name,
              result: toolResult,
            };

            if (contextGuard.shouldBreak()) {
              yield { type: 'finish', finishReason: 'length' };
              return;
            }

            currentMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: toGroqToolResult(toolResult),
            } as ChatCompletionMessageParam);
          }

          yield {
            type: 'step-finish',
            stepNumber,
            finishReason: 'tool-calls',
          };
          continue;
        }

        if (assistantContent) {
          currentMessages.push({
            role: 'assistant',
            content: assistantContent,
          } as ChatCompletionMessageParam);
        }
        const rawFinishReason = finishReason || 'stop';
        const effectiveFinishReason = rawFinishReason === 'stop' && sanitizer.wasTruncated()
          ? 'length'
          : rawFinishReason;
        if (effectiveFinishReason !== rawFinishReason) {
          debugLog('[groq] finish reason remapped stop->length due to sanitizer truncation');
        }

        yield {
          type: 'step-finish',
          stepNumber,
          finishReason: effectiveFinishReason,
        };
        yield {
          type: 'finish',
          finishReason: effectiveFinishReason,
        };
        return;
      }
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}