import { describe, expect, it, mock, beforeEach } from "bun:test";
import { Agent } from "../Agent";
import * as configUtils from "../../utils/config";

mock.module("../../utils/config", () => ({
  readConfig: () => ({
    provider: "mistral",
    model: "mistral-large-latest",
  }),
  getApiKeyForProvider: () => "test-key",
  getAuthForProvider: () => ({ type: "api_key", apiKey: "test-key" }),
  getLightweightRoute: () => ({
    providerId: "mistral",
    modelId: "mistral-small-latest",
  }),
  getMistralAuthMode: () => "codestral-only",
  normalizeModelForProvider: (p: string, m: string) => m,
  setActiveModel: () => {},
  getModelReasoningEffort: () => undefined,
}));

mock.module("../provider/mistralAuth", () => ({
  resolveMistralBackendForKey: async () => "codestral-domain",
  isCodestralModel: (m: string) => m === "codestral-latest",
}));

mock.module("../tools/definitions", () => ({
  getTools: () => ({}),
}));
mock.module("../memory", () => ({
  getGlobalMemory: () => ({
    getStats: () => ({ files: 0, searches: 0, toolCalls: 0 }),
    incrementTurn: () => {},
  }),
}));
mock.module("../repoScan", () => ({
  clearRepositoryScanCache: () => {},
}));

describe("Agent metadata", () => {
  it("should preserve routedModel while using transportModel for codestral-only auth", () => {
    const runtimeContext: any = {
      taskModeDecision: { mode: "chat" },
    };

    const agent = new Agent(runtimeContext);
    const metadata = agent.getRunMetadata();

    expect(metadata.configuredModel).toBe("mistral-large-latest");
    expect(metadata.routedModel).toBe("mistral-small-latest");
    expect(metadata.transportModel).toBe("codestral-latest");
    expect(metadata.backend).toBe("codestral-domain");
    expect(metadata.model).toBe("codestral-latest");
  });

  it("should use configured model as routed model when not in lightweight mode", () => {
    const runtimeContext: any = {
      taskModeDecision: { mode: "edit" },
    };

    const agent = new Agent(runtimeContext);
    const metadata = agent.getRunMetadata();

    expect(metadata.configuredModel).toBe("mistral-large-latest");
    expect(metadata.routedModel).toBe("mistral-large-latest");
    expect(metadata.transportModel).toBe("codestral-latest");
    expect(metadata.backend).toBe("codestral-domain");
  });
});
