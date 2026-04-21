import { describe, expect, it, spyOn, beforeEach } from "bun:test";
import {
  isModelSupportedByMistralKey,
  resolveMistralBackendForKey,
  isCodestralModel,
} from "../mistralAuth";
import * as config from "../../../utils/config";
import { createHash } from "crypto";
import { Agent } from "../../Agent";

function computeFingerprint(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

describe("Mistral resolution logic", () => {
  const mockConfig: any = {
    mistralResolvedBackendByKey: {},
    mistralModelSupportByKey: {},
  };

  beforeEach(() => {
    mockConfig.mistralResolvedBackendByKey = {};
    mockConfig.mistralModelSupportByKey = {};
    spyOn(config, "readConfig").mockReturnValue(mockConfig);
    spyOn(config, "writeConfig").mockImplementation((c) => {
      Object.assign(mockConfig, c);
    });
  });

  it("should identify Codestral models correctly", () => {
    expect(isCodestralModel("codestral-latest")).toBe(true);
    expect(isCodestralModel("codestral-2405")).toBe(true);
    expect(isCodestralModel("mistral-large-latest")).toBe(false);
  });

  it("should not force codestral-latest if the routed model is supported on codestral-domain", async () => {
    const apiKey = "abc-123";
    const fingerprint = computeFingerprint(apiKey);

    mockConfig.mistralResolvedBackendByKey = {
      [fingerprint]: "codestral-domain",
    };
    mockConfig.mistralModelSupportByKey = {
      [fingerprint]: ["mistral-small-latest"],
    };

    const backend = await resolveMistralBackendForKey(mockConfig, apiKey);
    expect(backend).toBe("codestral-domain");

    const probe = await isModelSupportedByMistralKey(
      mockConfig,
      apiKey,
      "mistral-small-latest",
      backend,
    );
    expect(probe.supported).toBe(true);
  });

  it("should try generic-api if the routed model is rejected on codestral-domain", async () => {
    const apiKey = "abc-123";
    const fingerprint = computeFingerprint(apiKey);

    mockConfig.mistralResolvedBackendByKey = {
      [fingerprint]: "codestral-domain",
    };
  });

  it("should fallback to codestral-latest when all backends fail", async () => {
    const apiKey = "total-fail";
    const fingerprint = computeFingerprint(apiKey);

    mockConfig.mistralResolvedBackendByKey = {
      [fingerprint]: "codestral-domain",
    };

    const probe = await isModelSupportedByMistralKey(
      mockConfig,
      apiKey,
      "unsupported-model",
      "codestral-domain",
    );
    expect(probe.supported).toBe(false);
    expect(probe.resolvedBackend).toBe("codestral-domain");
  });

  it("should reflect actual transport and backend in Agent RunMetadata", async () => {
    const apiKey = "meta-test";
    const fingerprint = computeFingerprint(apiKey);

    mockConfig.provider = "mistral";
    mockConfig.model = "mistral-large-latest";
    mockConfig.apiKeys = { mistral: apiKey };
    mockConfig.mistralResolvedBackendByKey = {
      [fingerprint]: "codestral-domain",
    };
    mockConfig.mistralModelSupportByKey = {
      [fingerprint]: [],
    };

    const agent = new Agent();
    const initialMetadata = agent.getRunMetadata();
    expect(initialMetadata.transportModel).toBe("mistral-large-latest");

    const stream = agent.sendMessage("hi");
    await stream.next();

    const finalMetadata = agent.getRunMetadata();
    expect(finalMetadata.transportModel).toBe("codestral-latest");
    expect(finalMetadata.backend).toBe("codestral-domain");
    expect(finalMetadata.routedModel).toBe("mistral-large-latest");
  });
});
