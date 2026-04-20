import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const homeDir = join(process.cwd(), ".tmp-history-home");

mock.module("os", () => ({
  homedir: () => homeDir,
}));

import {
  loadConversationById,
  saveConversation,
} from "../history";

describe("history metadata", () => {
  beforeEach(() => {
    rmSync(join(homeDir, ".mosaic"), { recursive: true, force: true });
    mkdirSync(homeDir, { recursive: true });
  });

  it("persists effective runtime metadata", () => {
    saveConversation({
      id: "conv-1",
      timestamp: 123,
      steps: [
        {
          type: "assistant",
          content: "Hello",
          timestamp: 123,
        },
      ],
      totalSteps: 1,
      model: "mistral-medium-latest",
      provider: "mistral",
      runMetadata: {
        configuredProvider: "mistral",
        configuredModel: "mistral-large-latest",
        effectiveProvider: "mistral",
        effectiveModel: "mistral-medium-latest",
        authType: "codestral-only",
        lightweightRoutingUsed: true,
        fallbackOccurred: true,
        routeReason: "lightweight route selected",
      },
    });

    const loaded = loadConversationById("conv-1");
    expect(loaded?.provider).toBe("mistral");
    expect(loaded?.model).toBe("mistral-medium-latest");
    expect(loaded?.runMetadata).toEqual({
      configuredProvider: "mistral",
      configuredModel: "mistral-large-latest",
      effectiveProvider: "mistral",
      effectiveModel: "mistral-medium-latest",
      authType: "codestral-only",
      lightweightRoutingUsed: true,
      fallbackOccurred: true,
      routeReason: "lightweight route selected",
    });
  });
});
