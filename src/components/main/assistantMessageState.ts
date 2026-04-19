import { getThinkingCollapsed } from "../../utils/config";
import type { Message } from "./types";

export const getDefaultThinkingCollapsed = () => getThinkingCollapsed();

type AssistantMessagePatch = Partial<Omit<Message, "id" | "role">>;

function hasThinkingContent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveThinkingCollapsed(
  previous: Message | undefined,
  nextThinkingContent: string | undefined,
): boolean | undefined {
  if (!hasThinkingContent(nextThinkingContent)) {
    return undefined;
  }
  if (typeof previous?.thinkingCollapsed === "boolean") {
    return previous.thinkingCollapsed;
  }
  return getDefaultThinkingCollapsed();
}

export function buildAssistantMessage(
  messageId: string,
  previous: Message | undefined,
  patch: AssistantMessagePatch,
): Message {
  const nextThinkingContent = patch.thinkingContent ?? previous?.thinkingContent;

  return {
    ...(previous ?? {
      id: messageId,
      role: "assistant" as const,
      content: "",
    }),
    ...patch,
    id: messageId,
    role: "assistant",
    thinkingCollapsed: resolveThinkingCollapsed(previous, nextThinkingContent),
    thinkingRunning: patch.thinkingRunning ?? previous?.thinkingRunning,
  };
}

export function upsertAssistantMessage(
  messages: Message[],
  messageId: string,
  patch: AssistantMessagePatch,
): Message[] {
  const nextMessages = [...messages];
  const messageIndex = nextMessages.findIndex((message) => message.id === messageId);
  const previous = messageIndex >= 0 ? nextMessages[messageIndex] : undefined;
  const nextMessage = buildAssistantMessage(messageId, previous, patch);

  if (messageIndex === -1) {
    nextMessages.push(nextMessage);
  } else {
    nextMessages[messageIndex] = nextMessage;
  }

  return nextMessages;
}

export function normalizeAssistantMessage(message: Message): Message {
  if (message.role !== "assistant") {
    return message;
  }
  return buildAssistantMessage(message.id, message, {});
}
