<p align="center">
  <img src="docs/logo_white.svg" width="200" alt="Mosaic logo" />
</p>

<h1 align="center">Mosaic</h1>

<p align="center">
  <strong>Memory-first AI coding agent for terminal workflows</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#provider-support">Provider Support</a> •
  <a href="#development">Development</a> •
  <a href="#technical-docs">Technical Docs</a>
</p>

---

Mosaic is an open-source coding agent built around a terminal UI, a tool-driven agent runtime, MCP integration, and multi-provider model support.

## Highlights

- Terminal UI built with React and OpenTUI
- Task-mode routing for lightweight chat, assistant capability questions, read-only exploration, planning, edits, execution, and review
- Built-in coding tools (`read`, `write`, `edit`, `bash`, `glob`, `grep`, `explore`, and more)
- MCP server management from the CLI
- Approval workflow for risky actions
- Conversation history and resume support
- Repo-aware runtime context with repository scan, git workspace aggregation, and compaction

## Installation

Mosaic is **Bun-first**.

- Bun is required to run Mosaic.
- Bun is the package manager used to develop this repository.
- The npm registry is only the package distribution channel.

### Recommended: run with Bun directly

```bash
bunx @kirosnn/mosaic@latest
```

### Optional: install globally with Bun

```bash
bun install -g @kirosnn/mosaic
mosaic
```

### Compatibility path: install from npm

```bash
npm install -g @kirosnn/mosaic
mosaic
```

This compatibility path still requires Bun to be installed and available on `PATH`, because the published launcher delegates runtime execution to Bun.

### From source

```bash
git clone https://github.com/kirosnn/mosaic.git
cd mosaic
bun install
bun run start
```

## Runtime Requirements

- Bun 1.3+
- Node.js 18+ only if you use the npm-based install path

## Quick Start

1. Run `mosaic` in your project directory.
2. Complete provider/model setup in the TUI.
3. Run `/init` to generate or refresh `AGENTS.md` and `.mosaic/skills`.
4. Ask for a concrete task.

Examples:

```bash
mosaic
mosaic ./my-project
mosaic run "fix failing tests in parser"
mosaic resume
```

## Package Manager Policy

The repository source of truth is:

- package manager: `bun`
- lockfile: `bun.lock`

Contributor expectations:

- use `bun install`
- use `bun run <script>`
- do not add a root `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow.

## Commands

### CLI

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

### Slash commands

| Command | Description |
|---|---|
| `/help` | Show available slash commands |
| `/init` | Initialize workspace context (`AGENTS.md` + `.mosaic/skills`) |
| `/provider [id]` | List or switch AI provider |
| `/model [id]` | List or switch model for active provider |
| `/approvals on\|off\|toggle\|status` | Manage approval mode |
| `/new` | Start a new chat (alias: `/clear`) |
| `/compact [maxTokens]` | Compact current conversation context |
| `/context [--full]` | Show context budget diagnostics |
| `/image <path>` | Attach image for next message |
| `/image clear` | Clear pending images |
| `/skill ...` | Manage workspace skills |
| `/echo <text>` | Echo text |

## Authentication

Mosaic supports API-key and selected OAuth flows.

```bash
mosaic auth list
mosaic auth set --provider openai --token <key>
mosaic auth remove --provider openai
mosaic auth login openai
mosaic auth login google
```

## Provider Support

The codebase exposes multiple providers, but support levels are not identical.

| Provider | Status | Notes |
|---|---|---|
| OpenAI API key | supported | Primary path, full tool/runtime support |
| OpenAI OAuth | supported with caveats | Limited to supported ChatGPT-account models |
| Anthropic API key | supported | No OAuth path |
| Google API key | supported | Standard Gemini API path |
| Google OAuth | supported with caveats | Code Assist onboarding and single-tool-per-response constraint |
| Mistral API key | supported | Standard API-key path |
| xAI API key | supported | Standard API-key path |
| Groq API key | supported with caveats | Custom tool-calling adapter |
| Ollama local | supported with caveats | Requires local Ollama runtime/model availability |
| Ollama cloud | supported with caveats | Requires Ollama cloud/API access |
| OpenRouter | supported with caveats | Behavior depends on upstream routed model |

Full matrix: [docs/provider-support.md](docs/provider-support.md)

## MCP Integration

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

Native MCP servers currently include:

- `nativesearch`
- `nativereact`

## Skills and Workspace Context

`/init` prepares:

- `AGENTS.md`
- `.mosaic/skills/local`
- `.mosaic/skills/team`
- `.mosaic/skills/vendor`

## Configuration

### Global paths

- `~/.mosaic/mosaic.jsonc`
- `~/.mosaic/history/`
- `~/.mosaic/mcp/`
- `~/.mosaic/debug.log`

### Project paths

- `AGENTS.md`
- `.mosaic/`

## Electron IDE

The Electron surface is experimental and source-only for now.

```bash
bun install
bun run electron:dev
```

It is not part of the intended published package surface.

## Development

```bash
bun install
bun run dev
bun run start
bun run lint
bun test
```

## Repository Structure

- `src/app`: CLI and Electron entrypoints
- `src/agent`: core agent runtime, providers, prompts, tools
- `src/components`: terminal UI
- `src/mcp`: MCP runtime and CLI
- `src/utils`: shared config, history, commands, bridges
- `src/electron`: implementation modules still being migrated behind `src/app`
- `docs/architecture`: maintainer-facing technical design docs

Migration notes: [docs/architecture/repository-layout.md](docs/architecture/repository-layout.md)

## Release Surface

- release notes live in [CHANGELOG.md](CHANGELOG.md)
- release workflow and packaging policy live in [docs/release-process.md](docs/release-process.md)
- CI validates lint, tests, and package contents on pull requests

## Technical Docs

- [Architecture index](docs/architecture/README.md)
- [Task modes and runtime context](docs/architecture/runtime-routing.md)
- [Workspace aggregation and lifecycle](docs/architecture/workspace-and-lifecycle.md)
- [Providers and MCP integration](docs/architecture/providers-and-mcp.md)
- [Provider support matrix](docs/provider-support.md)

## License

MIT. See `LICENSE`.
