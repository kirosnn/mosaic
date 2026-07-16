import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateLocalTitle } from "../localTitle";
import { getDeterministicSafetyRefusal } from "../safetyPolicy";

const originalPolicyPath = process.env.MOSAIC_AGENT_POLICY;
let directory: string | null = null;

afterEach(() => {
  if (originalPolicyPath === undefined) delete process.env.MOSAIC_AGENT_POLICY;
  else process.env.MOSAIC_AGENT_POLICY = originalPolicyPath;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe("agent policy configuration", () => {
  it("loads title and safety behavior from an external policy", () => {
    directory = mkdtempSync(join(tmpdir(), "mosaic-policy-"));
    const path = join(directory, "policy.json");
    writeFileSync(path, JSON.stringify({
      title: {
        greetings: [{ pattern: "^yo$", title: "Configured title" }],
      },
      safety: {
        patterns: { configuredRisk: "configured-risk" },
        rules: [["configuredRisk"]],
        responses: [],
        defaultResponse: "Configured refusal",
      },
    }));
    process.env.MOSAIC_AGENT_POLICY = path;

    expect(generateLocalTitle("yo")).toBe("Configured title");
    expect(getDeterministicSafetyRefusal("configured-risk")).toBe("Configured refusal");
  });
});
