import { existsSync, readFileSync, statSync } from "fs";
import { basename } from "path";
import type { Command } from "./types";
import { guessImageMimeType } from "../images";
import { emitImageCommand, canUseImages } from "../imageBridge";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function parseImagePath(fullCommand: string): string {
  const trimmed = fullCommand.trim();
  const without = trimmed.replace(/^\/(image|img)\s+/i, "");
  return without.trim();
}

export const imageCommand: Command = {
  name: "image",
  description: "Attach an image for the next message",
  usage: "/image <path> | /image clear",
  aliases: ["img"],
  execute: (args, fullCommand) => {
    const first = args[0]?.toLowerCase();
    if (!first) {
      return {
        success: false,
        content: "Usage: /image <path> | /image clear",
        shouldAddToHistory: false
      };
    }

    if (first === "clear") {
      emitImageCommand({ type: "clear" });
      return {
        success: true,
        content: "Image list cleared.",
        shouldAddToHistory: false
      };
    }

    if (!canUseImages()) {
      return {
        success: false,
        content: "Images are not supported by the current model.",
        shouldAddToHistory: false
      };
    }

    const path = parseImagePath(fullCommand);
    if (!path) {
      return {
        success: false,
        content: "Missing image path.",
        shouldAddToHistory: false
      };
    }

    if (!existsSync(path)) {
      return {
        success: false,
        content: "File not found.",
        shouldAddToHistory: false
      };
    }

    const stat = statSync(path);
    if (!stat.isFile()) {
      return {
        success: false,
        content: "Not a file.",
        shouldAddToHistory: false
      };
    }

    if (stat.size > MAX_IMAGE_BYTES) {
      return {
        success: false,
        content: "Image too large (max 10 MB).",
        shouldAddToHistory: false
      };
    }

    const name = basename(path);
    const mimeType = guessImageMimeType(name);
    if (!mimeType.startsWith("image/")) {
      return {
        success: false,
        content: "Unsupported image type.",
        shouldAddToHistory: false
      };
    }

    const data = readFileSync(path).toString("base64");
    emitImageCommand({
      type: "add",
      image: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        mimeType,
        data,
        size: stat.size
      }
    });

    return {
      success: true,
      content: `Image attached: ${name}`,
      shouldAddToHistory: false
    };
  }
};
