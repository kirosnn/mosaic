import type { TestCase } from "../../types.js";
import {
  lastTurnOutputContainsNone,
  lastTurnOutputMatchesAny,
  minToolCalls,
  noProtocolLeak,
} from "../../scoring/rules.js";

export const multiTurnSuite: TestCase[] = [
  {
    id: "multi-turn:context-retention",
    suite: "multi-turn",
    name: "context-retention",
    prompt: "Trace the production timeout, then answer a follow-up from conversation context.",
    fixture: "MULTI_FILE_LOGIC",
    turns: [
      { prompt: "Inspect config.js, middleware.js, and handler.js. Explain how the production request timeout is derived." },
      { prompt: "What exact timeout finally reaches the handler? Answer with the value in milliseconds." },
    ],
    rules: [
      minToolCalls("read", 3, 15),
      lastTurnOutputMatchesAny(["45000", "45,000"], 25, "retains-effective-timeout"),
      noProtocolLeak(10),
    ],
  },
  {
    id: "multi-turn:instruction-correction",
    suite: "multi-turn",
    name: "instruction-correction",
    prompt: "Read package metadata, then follow a correction on the next turn.",
    fixture: "SIMPLE_JS_PROJECT",
    turns: [
      { prompt: "Read package.json and tell me its name and version." },
      { prompt: "Correction: answer only with the version. Do not repeat the package name." },
    ],
    rules: [
      lastTurnOutputMatchesAny(["1.0.0"], 20, "follows-corrected-version-request"),
      lastTurnOutputContainsNone(["simple-js-project"], 20, "does-not-repeat-package-name", true),
      noProtocolLeak(10),
    ],
  },
  {
    id: "multi-turn:single-title",
    suite: "multi-turn",
    name: "single-title",
    prompt: "Keep one stable conversation title across two related turns.",
    fixture: "SIMPLE_JS_PROJECT",
    turns: [
      { prompt: "Hello, inspect the project briefly." },
      { prompt: "Now summarize the available math operations." },
    ],
    rules: [
      {
        name: "one-title-for-conversation",
        description: "Exactly one title event was emitted for the conversation",
        weight: 30,
        isCritical: false,
        evaluate: (ctx) => ctx.events.filter((event) => event.type === "title").length === 1,
      },
      noProtocolLeak(10),
    ],
  },
];
