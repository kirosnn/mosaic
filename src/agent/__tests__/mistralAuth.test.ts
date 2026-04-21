import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import {
  getMistralCodestralAuthError,
  isCodestralModel,
  resolveMistralBackendForKey,
} from "../provider/mistralAuth";
import * as configUtils from "../../utils/config";
import * as ai from "ai";

mock.module("../../utils/debug", () => ({
  debugLog: () => {},
}));

describe("Mistral auth helpers", () => {
  it("detects codestral models", () => {
    expect(isCodestralModel("codestral-latest")).toBe(true);
    expect(isCodestralModel("mistral-large-latest")).toBe(false);
  });

  it("rejects generic mistral models for codestral-only auth", () => {
    expect(getMistralCodestralAuthError("mistral-large-latest")).toContain(
      "Codestral-only",
    );
  });

  it("allows codestral models for codestral-only auth", () => {
    expect(getMistralCodestralAuthError("codestral-latest")).toBeNull();
  });
});

describe("resolveMistralBackendForKey", () => {
  let mockConfig: any;
  let savedConfig: any;

  beforeEach(() => {
    mockConfig = {
      mistralResolvedBackendByKey: {},
    };
    savedConfig = null;

    mock.module("../../utils/config", () => ({
      readConfig: () => mockConfig,
      writeConfig: (c: any) => {
        savedConfig = c;
        mockConfig = c;
      },
    }));
  });

  it("reuses cached resolved backend for the same key fingerprint", async () => {
    const apiKey = "test-key-1";

    let callCount = 0;
    mock.module("ai", () => ({
      generateText: async () => {
        callCount++;
        return { text: "ok" };
      },
    }));

    const backend1 = await resolveMistralBackendForKey(mockConfig, apiKey);
    expect(backend1).toBe("generic-api");
    expect(callCount).toBe(1);

    const backend2 = await resolveMistralBackendForKey(mockConfig, apiKey);
    expect(backend2).toBe("generic-api");
    expect(callCount).toBe(1);
  });

  it("does not share backend state between different API keys", async () => {
    let callCount = 0;
    mock.module("ai", () => ({
      generateText: async ({ model }: any) => {
        callCount++;
        if (callCount === 2) throw new Error("unauthorized");
        return { text: "ok" };
      },
    }));

    const backend1 = await resolveMistralBackendForKey(mockConfig, "key-1");
    expect(backend1).toBe("generic-api");

    const backend2 = await resolveMistralBackendForKey(mockConfig, "key-2");
    expect(backend2).toBe("codestral-domain");
  });

  it("persists 'generic-api' when generic probe succeeds", async () => {
    mock.module("ai", () => ({
      generateText: async () => ({ text: "ok" }),
    }));

    await resolveMistralBackendForKey(mockConfig, "key-generic");
    expect(savedConfig.mistralResolvedBackendByKey).toBeDefined();
    const values = Object.values(savedConfig.mistralResolvedBackendByKey);
    expect(values).toContain("generic-api");
  });

  it("persists 'codestral-domain' when generic fails but codestral succeeds", async () => {
    mock.module("ai", () => ({
      generateText: async ({ model }: any) => {
        if (model.modelId.includes("small")) throw new Error("unauthorized");
        return { text: "ok" };
      },
    }));

    await resolveMistralBackendForKey(mockConfig, "key-codestral");
    const values = Object.values(savedConfig.mistralResolvedBackendByKey);
    expect(values).toContain("codestral-domain");
  });

  it("does not persist result on transient failures", async () => {
    mock.module("ai", () => ({
      generateText: async () => {
        throw new Error("network error");
      },
    }));

    try {
      await resolveMistralBackendForKey(mockConfig, "key-transient");
    } catch (e) {
      // Expected
    }
    expect(savedConfig).toBeNull();
  });

  it("throws precise error when both probes fail with unauthorized", async () => {
    mock.module("ai", () => ({
      generateText: async () => {
        throw new Error("Unauthorized access");
      },
    }));

    try {
      await resolveMistralBackendForKey(mockConfig, "key-fail");
      expect(false).toBe(true);
    } catch (e: any) {
      expect(e.message).toContain(
        "could not be validated for either generic Mistral or Codestral access",
      );
    }
  });

  it("never probes twice concurrently for the same key", async () => {
    let callCount = 0;
    let resolveProbe: any;
    const probeStarted = new Promise((resolve) => {
      resolveProbe = resolve;
    });

    mock.module("ai", () => ({
      generateText: async () => {
        callCount++;
        await probeStarted;
        return { text: "ok" };
      },
    }));

    const p1 = resolveMistralBackendForKey(mockConfig, "concurrent-key");
    const p2 = resolveMistralBackendForKey(mockConfig, "concurrent-key");

    resolveProbe();

    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toBe("generic-api");
    expect(b2).toBe("generic-api");
    expect(callCount).toBe(1);
  });
});
