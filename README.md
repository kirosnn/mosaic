<p align="center">
  <img src="docs/logo_white.svg" width="200" />
</p>

<h1 align="center">Mosaic CLI</h1>

<p align="center">
  <strong>Version 0.70.0</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#ai-providers">Providers</a> •
  <a href="#contributing">Contributing</a>
</p>

---

Mosaic is an open-source, AI-powered coding agent for the terminal. It combines a React-based TUI (OpenTUI) with a tool-driven agent architecture to deliver a fast, context-aware development workflow. A web UI is also available for those who prefer a browser experience.

## Highlights

- Multi-provider AI support (OpenAI, Anthropic, Google, Mistral, xAI, Ollama)
- Terminal-first UI powered by React + OpenTUI
- Optional web interface on http://127.0.0.1:8192
- Built-in tools for file operations, search, and shell commands
- Slash commands for quick actions
- Project context via `MOSAIC.md` files

## Requirements

- [Bun](https://bun.sh) (required at runtime)
- Node.js >= 18 (for npm installation)

## Installation

### Via npm (recommended)

```bash
npm install -g @kirosnn/mosaic
```

Then run from any directory:

```bash
mosaic
```

### Via npx (no install)

```bash
npx @kirosnn/mosaic
```

### From source

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

> **Note:** Mosaic requires Bun at runtime. If Bun is not installed, the CLI will prompt you to install it.

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

## Slash Commands

| Command     | Description                          |
|-------------|--------------------------------------|
| `/init`     | Initialize project context (MOSAIC.md) |
| `/help`     | Show available commands              |
| `/undo`     | Undo last file change                |
| `/redo`     | Redo undone change                   |
| `/sessions` | Manage conversation sessions         |
| `/web`      | Open web interface                   |
| `/echo`     | Echo a message (debug)               |

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

| Tool       | Description                              |
|------------|------------------------------------------|
| `read`     | Read file contents                       |
| `write`    | Create or overwrite files                |
| `edit`     | Apply targeted edits to files            |
| `bash`     | Execute shell commands                   |
| `glob`     | Find files by pattern                    |
| `grep`     | Search code with regex                   |
| `list`     | List directory contents                  |
| `question` | Ask clarifying questions to the user     |

**Safety Features:**
- Write and edit operations require user approval before execution
- Built-in undo/redo system tracks all file changes (SQLite-backed)
- Project context via `MOSAIC.md` helps the agent understand your codebase

## AI Providers

Mosaic uses the Vercel AI SDK and currently supports:

| Provider   | Models                        |
|------------|-------------------------------|
| OpenAI     | GPT-5, GPT-4, GPT-3.5         |
| Anthropic  | Claude Sonnet, Haiku, Opus    |
| Google     | Gemini 3 and others           |
| Mistral    | Mistral Large, Mixtral        |
| xAI        | Grok                          |
| Ollama     | Any local model               |

Configure your preferred provider on first run or edit `~/.mosaic/mosaic.jsonc`.

## Development

```bash
bun run dev              # Watch mode
bun run start            # Normal run
```

## Contributing

Issues and pull requests are welcome. Please include clear reproduction steps and context for behavior changes.

## License

MIT - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with <a href="https://bun.sh">Bun</a>, <a href="https://react.dev">React</a>, and <a href="https://opentui.com">OpenTUI</a>
</p>
