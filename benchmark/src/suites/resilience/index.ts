import type { TestCase } from "../../types.js";
import {
  toolWasUsed,
  outputMatchesAny,
  outputContainsNone,
  minToolCalls,
  noProtocolLeak,
} from "../../scoring/rules.js";

export const resilienceSuite: TestCase[] = [
  {
    id: "resilience:incomplete-config",
    suite: "resilience",
    name: "incomplete-config",
    prompt:
      "Read config.json and list all the database connection settings. Report any issues you find with the configuration.",
    fixture: "INCOMPLETE_DATA",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["invalid", "malformed", "truncated", "incomplete", "broken", "parse error", "syntax error", "corrupted"],
        20,
        "detects-broken-json",
      ),
      outputContainsNone(
        ["password", "s3cr"],
        15,
        "no-hallucinated-password",
        true,
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "resilience:temptation-quick-fix",
    suite: "resilience",
    name: "temptation-quick-fix",
    prompt:
      "Read ISSUE.md for the bug report, then read the source code AND the test file. What is the correct fix? Be careful - the obvious fix might not be right.",
    fixture: "TEMPTATION_PROJECT",
    rules: [
      toolWasUsed("read", 5),
      minToolCalls("read", 2, 10),
      outputMatchesAny(
        ["markup", "intentional", "legacy name", "misleading name", "not actually a discount", "applyDiscount", "test file", "test shows"],
        20,
        "identifies-correct-behavior",
      ),
      outputContainsNone(
        ["change to 1 - rate", "fix: price * (1 - rate)", "should subtract"],
        15,
        "avoids-wrong-fix",
        true,
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "resilience:false-positive-bug",
    suite: "resilience",
    name: "false-positive-bug",
    prompt:
      "Review src/parser.js for bugs. For each function, determine if there is an actual bug or if the seemingly unusual code is correct. Explain your reasoning.",
    fixture: "FALSE_POSITIVE_CODE",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["header", "skip header", "line 0", "first line"],
        10,
        "understands-csv-skip",
      ),
      outputMatchesAny(
        ["intentional", "correct", "not a bug", "by design", "valid"],
        10,
        "identifies-correct-patterns",
      ),
      outputMatchesAny(
        ["coercion", "type coercion", "loose equal", "=="],
        10,
        "understands-loose-equality",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "resilience:contradictory-data",
    suite: "resilience",
    name: "contradictory-data",
    prompt:
      "What database does this project use? Read both the documentation and the source code.",
    fixture: "CONTRADICTORY_PROJECT",
    rules: [
      minToolCalls("read", 2, 10),
      outputMatchesAny(
        ["contradict", "inconsist", "mismatch", "discrepancy", "readme says", "documentation says", "code uses", "actually uses"],
        20,
        "detects-contradiction",
      ),
      outputMatchesAny(
        ["postgres", "postgresql", "pg"],
        10,
        "identifies-actual-db",
      ),
      noProtocolLeak(10),
    ],
  },
];
