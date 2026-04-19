import { describe, expect, it } from "bun:test";
import { createProvider } from "../taskModeModel";

describe("taskModeModel normalization", () => {
  it("should normalize google-oauth to google", async () => {
    const provider = await createProvider("google-oauth");
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toBe("GoogleProvider");
  });

  it("should normalize openai-oauth to openai", async () => {
    const provider = await createProvider("openai-oauth");
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toBe("OpenAIProvider");
  });
});
