import type { CoreMessage } from "ai";
import { debugLog } from "../utils/debug";

export function sanitizeHistory(messages: CoreMessage[]): CoreMessage[] {
  const sanitized: CoreMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    if (!msg.content) {
      debugLog(
        `[sanitizer] skipping empty message at index ${i} role=${msg.role}`,
      );
      continue;
    }

    if (typeof msg.content === "string" && msg.content.trim() === "") {
      debugLog(
        `[sanitizer] skipping empty string content message at index ${i} role=${msg.role}`,
      );
      continue;
    }

    if (Array.isArray(msg.content) && msg.content.length === 0) {
      debugLog(
        `[sanitizer] skipping empty array content message at index ${i} role=${msg.role}`,
      );
      continue;
    }

    if (msg.role === "assistant") {
      const last = sanitized[sanitized.length - 1];
      if (last?.role === "assistant") {
        debugLog(
          `[sanitizer] detected consecutive assistant messages at index ${i}, skipping to maintain valid sequence`,
        );
        continue;
      }
    }

    sanitized.push(msg);
  }

  return sanitized;
}
