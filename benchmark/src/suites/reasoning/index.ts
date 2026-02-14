import type { TestCase } from "../../types.js";
import {
  toolWasUsed,
  outputContains,
  outputMatchesAny,
  minToolCalls,
  noProtocolLeak,
} from "../../scoring/rules.js";

export const reasoningSuite: TestCase[] = [
  {
    id: "reasoning:debug-logic-error",
    suite: "reasoning",
    name: "debug-logic-error",
    prompt:
      "Read src/processor.js and identify all bugs in the code. Explain each bug and how to fix it.",
    fixture: "BUGGY_CODE",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["off-by-one", "off by one", "<= items.length", "i <= items.length", "boundary", "out of bounds", "undefined"],
        15,
        "identifies-off-by-one",
      ),
      outputMatchesAny(
        ["division by zero", "divide by zero", "empty array", "numbers.length", "length is 0", "NaN"],
        15,
        "identifies-division-by-zero",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "reasoning:math-computation",
    suite: "reasoning",
    name: "math-computation",
    prompt:
      "Read src/sort.js. What is the result of running bubbleSort on the input array [5, 3, 8, 1, 9, 2, 7, 4, 6]? Give me the exact sorted array.",
    fixture: "BUBBLE_SORT",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["[1, 2, 3, 4, 5, 6, 7, 8, 9]", "1, 2, 3, 4, 5, 6, 7, 8, 9"],
        20,
        "correct-sorted-result",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "reasoning:dependency-analysis",
    suite: "reasoning",
    name: "dependency-analysis",
    prompt:
      "Analyze the import/dependency graph of this TypeScript project. List every import statement with its source file and imported module specifier.",
    fixture: "TS_PROJECT",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["./services/user-service", "user-service", "userservice"],
        10,
        "finds-user-service-import",
      ),
      outputMatchesAny(
        ["./utils/logger", "utils/logger"],
        10,
        "finds-logger-import",
      ),
      outputMatchesAny(
        ["../types", "./types", "from '../types'", "from \"../types\""],
        5,
        "finds-types-import",
      ),
      outputMatchesAny(
        ["index.ts imports", "index.ts", "entry"],
        5,
        "identifies-entry-point",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "reasoning:algorithm-complexity",
    suite: "reasoning",
    name: "algorithm-complexity",
    prompt:
      "Read src/services/user-service.ts and analyze the time complexity of each method (getAll, getById, getProfile). Give the Big O notation for each.",
    fixture: "TS_PROJECT",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(["o(1)", "o(n)", "constant", "linear"], 10, "has-complexity-analysis"),
      outputContains("getAll", 5),
      outputContains("getById", 5),
      outputContains("getProfile", 5),
      noProtocolLeak(10),
    ],
  },
  {
    id: "reasoning:cross-file-state",
    suite: "reasoning",
    name: "cross-file-state",
    prompt:
      "What is the effective request timeout value when this application runs in production mode? Read all relevant files to trace the value through the entire chain.",
    fixture: "MULTI_FILE_LOGIC",
    rules: [
      minToolCalls("read", 3, 10),
      outputMatchesAny(
        ["45000", "45 sec", "45s", "45,000"],
        20,
        "correct-effective-timeout",
      ),
      outputMatchesAny(
        ["override", "overrid", "cap", "Math.min", "safety", "max_timeout"],
        10,
        "explains-override-chain",
      ),
      outputMatchesAny(
        ["30000", "30 sec"],
        5,
        "mentions-original-value",
      ),
      noProtocolLeak(10),
    ],
  },
  {
    id: "reasoning:hidden-mutation",
    suite: "reasoning",
    name: "hidden-mutation",
    prompt:
      "Read src/transformer.js. If I call `processData({items: [1, 2, 3]})`, what is the state of the original input object AFTER the call? Does the function mutate its input?",
    fixture: "MUTATION_CODE",
    rules: [
      toolWasUsed("read", 10),
      outputMatchesAny(
        ["mutate", "mutation", "modify", "modified", "side effect", "changes the original", "mutates"],
        15,
        "identifies-mutation",
      ),
      outputMatchesAny(
        ["2, 4, 6", "[2,4,6]", "2,4,6"],
        15,
        "correct-mutated-items",
      ),
      outputMatchesAny(
        ["processed", "true"],
        5,
        "identifies-new-property",
      ),
      noProtocolLeak(10),
    ],
  },
];
