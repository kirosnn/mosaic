import type { TestCase } from "../../types.js";
import {
  toolWasUsed,
  anyToolUsed,
  anyToolCalledBefore,
  minDistinctTools,
  outputContains,
  noProtocolLeak,
} from "../../scoring/rules.js";

const DISCOVERY_TOOLS = ["glob", "grep", "list", "bash"];

export const toolUseSuite: TestCase[] = [
  {
    id: "tool-use:read-file",
    suite: "tool-use",
    name: "read-file",
    prompt: "Read src/index.js and tell me what functions are exported.",
    fixture: "SIMPLE_JS_PROJECT",
    rules: [
      toolWasUsed("read", 15),
      outputContains("main", 10),
      outputContains("add", 5),
      noProtocolLeak(10),
    ],
  },
  {
    id: "tool-use:glob-search",
    suite: "tool-use",
    name: "glob-search",
    prompt: "Find all JavaScript files in this project.",
    fixture: "SIMPLE_JS_PROJECT",
    rules: [
      anyToolUsed(DISCOVERY_TOOLS, 15),
      outputContains("index.js", 5),
      outputContains("math.js", 5),
      outputContains("utils.js", 5),
      noProtocolLeak(10),
    ],
  },
  {
    id: "tool-use:grep-code",
    suite: "tool-use",
    name: "grep-code",
    prompt: "Search for all function declarations in the src/ directory.",
    fixture: "SIMPLE_JS_PROJECT",
    rules: [
      anyToolUsed(["grep", "glob", "read", "bash"], 15),
      outputContains("add", 5),
      outputContains("subtract", 5),
      outputContains("multiply", 5),
      noProtocolLeak(10),
    ],
  },
  {
    id: "tool-use:multi-tool-chain",
    suite: "tool-use",
    name: "multi-tool-chain",
    prompt: "List all files in this project, then read the README.md and summarize its content.",
    fixture: "SIMPLE_JS_PROJECT",
    rules: [
      minDistinctTools(2, 10),
      anyToolCalledBefore(DISCOVERY_TOOLS, "read", 10),
      outputContains("simple", 5),
      outputContains("javascript", 5),
      noProtocolLeak(10),
    ],
  },
];
