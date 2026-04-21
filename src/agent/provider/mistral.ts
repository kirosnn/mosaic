import { streamText, CoreMessage } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import {
  AgentEvent,
  Provider,
  ProviderConfig,
  ProviderSendOptions,
} from "../types";
import { getRetryDecision, normalizeError, runWithRetry } from "./rateLimit";
import {
  applyMistralReasoning,
  resolveReasoningEnabled,
} from "./reasoningConfig";
import { debugLog } from "../../utils/debug";
import { StreamSanitizer } from "./streamSanitizer";
import { ContextGuard } from "./contextGuard";
import {
  getMistralCodestralAuthError,
  resolveMistralBackendForKey,
  isCodestralModel,
  MistralBackend,
  isModelSupportedByMistralKey,
} from "./mistralAuth";
import { readConfig } from "../../utils/config";

export class MistralProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions,
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, "");
    let cleanModel = config.model.trim().replace(/[\r\n]+/g, "");
    let authMode = config.authMode ?? "generic";
    let backend: MistralBackend = "generic-api";

    if (cleanApiKey) {
      const userConfig = readConfig();
      try {
        const initialBackend = await resolveMistralBackendForKey(
          userConfig,
          cleanApiKey,
        );

        const probe = await isModelSupportedByMistralKey(
          userConfig,
          cleanApiKey,
          cleanModel,
          initialBackend,
        );

        if (probe.supported) {
          cleanModel = config.model.trim().replace(/[\r\n]+/g, "");
          backend = probe.resolvedBackend;
        } else {
          debugLog(
            `[mistral] model=${cleanModel} not supported on any compatible backend, falling back to codestral-latest`,
          );
          cleanModel = "codestral-latest";
          backend = "codestral-domain";
        }
        authMode =
          backend === "codestral-domain" ? "codestral-only" : "generic";
      } catch (err: any) {
        yield {
          type: "error",
          error: err.message,
        };
        return;
      }
    }

    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(
      config.provider,
      cleanModel,
    );
    const baseURL =
      backend === "codestral-domain"
        ? "https://codestral.mistral.ai/v1"
        : "https://api.mistral.ai/v1";
    debugLog(
      `[mistral] starting stream model=${cleanModel} backend=${backend} baseURL=${baseURL} authMode=${authMode} messagesLen=${messages.length} reasoning=${reasoningEnabled}`,
    );

    if (authMode === "codestral-only") {
      const authError = getMistralCodestralAuthError(cleanModel);
      if (authError) {
        yield {
          type: "error",
          error: authError,
        };
        return;
      }
    }

    const mistral = createMistral({
      apiKey: cleanApiKey,
      baseURL,
    });
    const baseModel = mistral(cleanModel);
    const { model, systemPrompt } = applyMistralReasoning(
      baseModel,
      config.systemPrompt,
      reasoningEnabled,
    );

    try {
      let stepCounter = 0;

      yield* runWithRetry(
        async function* () {
          const result = streamText({
            model,
            messages: messages,
            system: systemPrompt,
            tools: config.tools,
            maxSteps: config.maxSteps || 100,
            maxTokens: config.maxOutputTokens ?? 16384,
            maxRetries: 0,
            abortSignal: options?.abortSignal,
          });

          const sanitizer = new StreamSanitizer();
          const contextGuard = new ContextGuard(config.maxContextTokens);

          for await (const chunk of result.fullStream as any) {
            const c: any = chunk;
            switch (c.type) {
              case "reasoning":
                if (c.textDelta) {
                  yield {
                    type: "reasoning-delta",
                    content: c.textDelta,
                  };
                }
                break;

              case "text-delta": {
                const safe = sanitizer.feed(c.textDelta);
                if (safe !== null) {
                  yield { type: "text-delta", content: safe };
                }
                break;
              }

              case "step-start":
                sanitizer.reset();
                yield {
                  type: "step-start",
                  stepNumber:
                    typeof c.stepIndex === "number" ? c.stepIndex : stepCounter,
                };
                stepCounter++;
                break;

              case "step-finish":
                yield {
                  type: "step-finish",
                  stepNumber:
                    typeof c.stepIndex === "number"
                      ? c.stepIndex
                      : Math.max(0, stepCounter - 1),
                  finishReason: String(c.finishReason ?? "stop"),
                };
                break;

              case "tool-call":
                yield {
                  type: "tool-call-end",
                  toolCallId: String(c.toolCallId ?? ""),
                  toolName: String(c.toolName ?? ""),
                  args: (c.args ?? {}) as Record<string, unknown>,
                };
                break;

              case "tool-result":
                contextGuard.trackToolResult(c.result);
                yield {
                  type: "tool-result",
                  toolCallId: String(c.toolCallId ?? ""),
                  toolName: String(c.toolName ?? ""),
                  result: c.result,
                };
                if (contextGuard.shouldBreak()) {
                  yield { type: "finish", finishReason: "length" };
                  return;
                }
                break;

              case "finish": {
                const finishReason = String(c.finishReason ?? "stop");
                const effectiveFinishReason =
                  finishReason === "stop" && sanitizer.wasTruncated()
                    ? "length"
                    : finishReason;
                if (effectiveFinishReason !== finishReason) {
                  debugLog(
                    "[mistral] finish reason remapped stop->length due to sanitizer truncation",
                  );
                }
                yield {
                  type: "finish",
                  finishReason: effectiveFinishReason,
                  usage: c.usage,
                };
                break;
              }

              case "error": {
                const err = normalizeError(c.error);
                const decision = getRetryDecision(err);
                if (decision.shouldRetry) {
                  throw err;
                }
                yield {
                  type: "error",
                  error: err.message,
                };
                break;
              }
            }
          }
        },
        { abortSignal: options?.abortSignal, key: config.provider },
      );
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      yield {
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
