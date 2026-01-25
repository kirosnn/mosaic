<p align="center">
  <img src="docs/mosaic.png" width="200" />
</p>

# Mosaic CLI

**Version 0.0.8**

Mosaic is an open-source, AI-powered coding agent for the terminal. It combines a React-based TUI (OpenTUI) with a tool-driven agent architecture to deliver a fast, context-aware development workflow. A web UI is also available for those who prefer a browser experience.

## Highlights

- Multi-provider AI support (OpenAI, Anthropic, Google, Mistral, xAI, Ollama)
- Terminal-first UI powered by React + OpenTUI
- Optional web interface on http://127.0.0.1:8192
- Built-in tools for file operations, search, and shell commands
- Slash commands for quick actions
- Project context via `MOSAIC.md` files

## Requirements

- [Bun](https://bun.sh)

## Installation (from source)

```bash
git clone https://github.com/kirosnn/mosaic.git
cd mosaic
bun install
bun link
```

After linking, run Mosaic from any directory:

```bash
mosaic
```

If you prefer not to link globally:

```bash
bun run mosaic
```

## Quick Start

1. Run `mosaic` in a project directory.
2. On first run, Mosaic creates `~/.mosaic/` and guides you through provider setup.
3. Initialize project context with:

```bash
/init
```

This creates:
- `MOSAIC.md` with project context and conventions
- `.mosaic/` for project-specific settings

## CLI Usage

```bash
mosaic                       # Start in current directory
mosaic ./my-project          # Start in a specific directory
mosaic run "fix the bug"     # Launch with a task
mosaic --help                # Show help
```

## Web Interface

```bash
mosaic web
```

Open http://127.0.0.1:8192 in your browser.

## Configuration

Mosaic stores global settings in `~/.mosaic/`:
- `mosaic.jsonc` includes first-run status and version metadata

Project-specific settings live in `.mosaic/` at the repository root.

## Project Structure

- `src/index.tsx` - CLI entry point and routing
- `src/agent/` - Agent core, tools, and providers
- `src/components/` - TUI components
- `src/web/` - Web UI and server
- `src/utils/` - Helpers, config, and commands

## How It Works

Mosaic relies on a tool registry that exposes safe, focused capabilities to the agent:

- File operations (read, write, edit)
- Directory listing and navigation
- Code search with regex
- Terminal command execution
- Interactive questions for clarification

The `MOSAIC.md` file helps the agent adapt to each repository by describing conventions and structure.

## AI Providers

Mosaic uses the Vercel AI SDK and currently supports:

- OpenAI (GPT family)
- Anthropic (Claude family)
- Google (Gemini family)
- Mistral (Mistral, Mixtral)
- xAI (Grok family)
- Ollama (local or cloud models)

## Development

```bash
bun run dev              # Watch mode
bun run start            # Normal run
```

## Contributing

Issues and pull requests are welcome. Please include clear reproduction steps and context for behavior changes.

## License

MIT
