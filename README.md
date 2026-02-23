<p align="center">
  <img src="docs/logo_white.svg" width="200" alt="Mosaic logo" />
</p>

<h1 align="center">Mosaic</h1>

<p align="center">
  <strong>Memory-first AI coding agent</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#development">Development</a>
</p>

---

Mosaic is an open-source AI coding agent focused on terminal workflows.
It combines a React + OpenTUI interface, a tool-driven agent runtime, MCP integration, and multi-provider model support.
## Highlights

- Terminal UI built with React and OpenTUI
- Multi-provider model support (OpenAI, Anthropic, Google, Mistral, xAI, Ollama, OpenRouter)
- Built-in coding tools (`read`, `write`, `edit`, `bash`, `glob`, `grep`, `explore`, and more)
- Approval workflow for risky actions, with optional auto-approve mode
- Conversation history + resume support
- MCP server management from the CLI
- Workspace context via `MOSAIC.md` + `.mosaic/skills`

## Requirements

- Bun runtime (required to run Mosaic)
- Node.js >= 18 (for npm installation path)

## Installation

### npm (recommended)

```bash
npm install -g @kirosnn/mosaic
```

Then run:

```bash
mosaic
```

### npx (no global install)

```bash
npx @kirosnn/mosaic
```

### From source

```bash
git clone https://github.com/kirosnn/mosaic.git
cd mosaic
bun install
bun link
mosaic
```

If Bun is missing, the launcher prints installation instructions automatically.

## Quick Start

1. Run `mosaic` in your project directory.
2. Complete first-run provider/model setup in the TUI.
3. Run `/init` to generate or refresh `MOSAIC.md` and create `.mosaic/skills`.
4. Start asking for concrete tasks (for example: fix a bug, implement a feature, refactor a module).

## Commands

### CLI Commands

```bash
mosaic
mosaic ./my-project
mosaic -d ./my-project
mosaic run "fix failing tests in parser"
mosaic resume
mosaic resume <session-id>
mosaic auth <subcommand>
mosaic mcp <subcommand>
mosaic uninstall --force
```

### Slash Commands (inside Mosaic)

| Command | Description |
|---|---|
| `/help` | Show available slash commands |
| `/init` | Initialize workspace context (`MOSAIC.md` + `.mosaic/skills`) |
| `/provider [id]` | List or switch AI provider |
| `/model [id]` | List or switch model for active provider |
| `/approvals on\|off\|toggle\|status` | Manage approval mode |
| `/new` | Start a new chat (alias: `/clear`) |
| `/compact [maxTokens]` | Compact current conversation context |
| `/context [--full]` | Show context budget diagnostics |
| `/image <path>` | Attach image for next message |
| `/image clear` | Clear pending images |
| `/skill ...` | Manage workspace skills |
| `/echo <text>` | Echo text (debug) |

Tip: run `/help` to see the exact command list for your current build.

## Authentication

Mosaic supports both API-key and OAuth flows.

### Auth CLI

```bash
mosaic auth list
mosaic auth set --provider openai --token <key>
mosaic auth remove --provider openai
mosaic auth login openai
mosaic auth login google
```

Supported OAuth providers currently include `openai` and `google`.

## MCP Integration

Mosaic can manage MCP servers directly:

```bash
mosaic mcp list
mosaic mcp tools [serverId]
mosaic mcp doctor
mosaic mcp add [name]
mosaic mcp show <serverId>
mosaic mcp logs <serverId>
mosaic mcp enable <serverId>
mosaic mcp disable <serverId>
mosaic mcp start <serverId>
mosaic mcp stop <serverId>
mosaic mcp restart <serverId>
mosaic mcp refresh [serverId]
mosaic mcp remove <serverId>
```

By default, Mosaic maintains native MCP servers including:

- `nativesearch`
- `nativereact`

## Built-in Agent Tools

Core internal tools include:

- `read`
- `write`
- `edit`
- `list`
- `glob`
- `grep`
- `bash`
- `question`
- `explore`
- `fetch`
- `plan`
- `title`

MCP tools are merged into the callable toolset at runtime.

## Skills and Workspace Context

`/init` prepares project context files:

- `MOSAIC.md`: workspace guidance for agents
- `.mosaic/skills/local`
- `.mosaic/skills/team`
- `.mosaic/skills/vendor`

Skills are auto-activated based on workspace configuration and can be managed with `/skill`.

## Configuration

### Global Paths

- `~/.mosaic/mosaic.jsonc`: main config (provider, model, approvals, custom models/providers)
- `~/.mosaic/history/`: conversation history + input history
- `~/.mosaic/mcp/`: MCP config, server files, logs
- `~/.mosaic/debug.log`: runtime debug log

### Project Paths

- `MOSAIC.md`: project-level context
- `.mosaic/`: project-local skill structure and metadata

## Safety Model

- Write/edit/shell operations are approval-gated by default.
- Use `/approvals off` to enable auto-approve mode.
- MCP approvals are managed per server/tool policy.

## Electron IDE (Experimental)

Mosaic now includes an Electron desktop interface inspired by coding-agent IDE workflows.

### Run

```bash
bun install
bun run electron:dev
```

### Features

- Workspace explorer with file open/create actions
- Built-in text editor with save support
- React renderer inside Electron (IDE-style layout)
- Streaming agent chat panel powered by the existing Mosaic agent runtime

## Development

```bash
bun install
bun run dev
bun run start
bunx tsc --noEmit
```

Optional:

```bash
bun test
```

## Project Structure

- `src/index.tsx`: CLI entrypoint and app bootstrap
- `src/components/`: TUI components
- `src/agent/`: core agent, providers, prompts, and internal tools
- `src/mcp/`: MCP runtime, config, and CLI
- `src/utils/`: config, commands, history, bridges, formatting, misc helpers
- `bin/mosaic.cjs`: launcher that validates Bun availability

## Contributing

Issues and pull requests are welcome.
Prefer focused, well-scoped changes with clear reproduction steps for bug fixes.
## License

MIT. See `LICENSE`.
