import { cli } from './cli';
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import App from "./components/App";

const args = process.argv.slice(2);

if (args.length > 0) {
  cli.parseArgs(args);
} else {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}