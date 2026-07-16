import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Agent } from "../Agent";
import * as configUtils from "../../utils/config";
import * as mistralAuth from "../provider/mistralAuth";

beforeEach(() => {
  spyOn(configUtils, "readConfig").mockReturnValue({
    provider: "mistral",
    model: "mistral-large-latest",
  });
  spyOn(configUtils, "getApiKeyForProvider").mockReturnValue("test-key");
  spyOn(configUtils, "getAuthForProvider").mockReturnValue({
    type: "api_key",
    apiKey: "test-key",
  });
  spyOn(configUtils, "getLightweightRoute").mockReturnValue({
    providerId: "mistral",
    modelId: "mistral-small-latest",
  });
  spyOn(configUtils, "getMistralAuthMode").mockReturnValue("codestral-only");
  spyOn(mistralAuth, "isCodestralModel").mockImplementation(
    (model) => model === "codestral-latest",
  );
});

afterEach(() => {
  mock.restore();
});

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
