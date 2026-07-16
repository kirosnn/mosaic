import { describe, expect, it } from "bun:test";
import { generateLocalTitle } from "../localTitle";

describe("local conversation titles", () => {
  it("creates deterministic titles for greetings", () => {
    expect(generateLocalTitle("Hello! ")).toBe("Greeting");
    expect(generateLocalTitle("Bonjour")).toBe("Salutation");
  });

  it("normalizes and limits task titles", () => {
    expect(generateLocalTitle("Please fix the failing parser tests.")).toBe("Fix the failing parser tests");
    expect(generateLocalTitle("Implement a very long request that contains far too many words to fit in a conversation title cleanly").length).toBeLessThanOrEqual(50);
  });
});
