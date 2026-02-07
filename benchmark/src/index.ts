import { runBenchmark } from "./runner/harness.js";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    suite: { type: "string", short: "s" },
    test: { type: "string", short: "t" },
    provider: { type: "string", short: "p" },
    model: { type: "string", short: "m" },
    runs: { type: "string", short: "r" },
    output: { type: "string", short: "o" },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`
mosaic-bench - Benchmark suite for Mosaic AI code agent

Usage:
  bun run src/index.ts [options]

Options:
  -s, --suite <name>    Run only a specific suite (tool-use, reasoning, code-reading, protocol, safety)
  -t, --test <id>       Run only tests matching this filter
  -p, --provider <id>   Override provider for this benchmark (restored after)
  -m, --model <id>      Override model for this benchmark (restored after)
  -r, --runs <n>        Number of runs to average (default: 4)
  -o, --output <path>   Custom output directory for results
  -v, --verbose         Show detailed output during test execution
  -h, --help            Show this help message
`);
  process.exit(0);
}

console.log("mosaic-bench v1.0.0\n");

await runBenchmark({
  suiteFilter: values.suite,
  testFilter: values.test,
  provider: values.provider,
  model: values.model,
  outputPath: values.output,
  runs: values.runs ? parseInt(values.runs, 10) : undefined,
  verbose: values.verbose ?? false,
});
