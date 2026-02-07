import type { TestCase } from "../../types.js";
import {
  toolWasUsed,
  outputContains,
  outputMatchesAny,
  noProtocolLeak,
} from "../../scoring/rules.js";

export const codeReadingSuite: TestCase[] = [
  {
    id: "code-reading:summarize-function",
    suite: "code-reading",
    name: "summarize-function",
    prompt: "Read src/services/user-service.ts and summarize what UserService does in 2-3 sentences.",
    fixture: "TS_PROJECT",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(["user", "users"], 10, "mentions-users"),
      outputMatchesAny(
        ["cache", "caching", "cached", "profile", "profiles"],
        10,
        "mentions-cache-or-profile",
      ),
      outputMatchesAny(["getall", "getbyid", "getprofile", "method", "methods"], 5, "mentions-methods"),
      noProtocolLeak(10),
    ],
  },
  {
    id: "code-reading:explain-architecture",
    suite: "code-reading",
    name: "explain-architecture",
    prompt: "Explain the overall architecture of this TypeScript project. What are the main components and how do they interact?",
    fixture: "TS_PROJECT",
    rules: [
      toolWasUsed("read", 5),
      outputContains("service", 10),
      outputContains("logger", 10),
      outputMatchesAny(["type", "interface", "model"], 5, "mentions-types"),
      outputMatchesAny(["import", "depend", "module", "layer"], 5, "mentions-structure"),
      noProtocolLeak(10),
    ],
  },
  {
    id: "code-reading:identify-pattern",
    suite: "code-reading",
    name: "identify-pattern",
    prompt: "Read src/service.ts and identify the design patterns used. For each pattern, point to the specific code construct that implements it.",
    fixture: "PATTERN_SERVICE",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["singleton", "getinstance", "private constructor", "static instance"],
        15,
        "identifies-singleton-evidence",
      ),
      outputMatchesAny(
        ["observer", "subscribe", "publish", "eventbus", "event bus"],
        10,
        "identifies-observer-evidence",
      ),
      outputMatchesAny(
        ["strategy", "datastrategy", "setstrategy", "apistrategy", "cachestrategy"],
        10,
        "identifies-strategy-evidence",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "code-reading:trace-data-flow",
    suite: "code-reading",
    name: "trace-data-flow",
    prompt: "Read src/index.ts and trace the execution flow step by step. What happens when main() is called?",
    fixture: "TS_PROJECT",
    rules: [
      toolWasUsed("read", 10),
      outputContains("logger", 5),
      outputMatchesAny(["userservice", "user service", "user-service"], 10, "mentions-user-service"),
      outputMatchesAny(["getall", "get all", "getprofile", "get profile"], 10, "traces-method-calls"),
      outputMatchesAny(["loop", "iterate", "for", "each user"], 5, "identifies-loop"),
      noProtocolLeak(10),
    ],
  },
];
