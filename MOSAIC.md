# MOSAIC.md - Project Context for AI Agents

This file provides contextual information about the Mosaic project to help AI agents work effectively in this workspace. It is **not** a README or user-facing documentation.

---

## 1. Project Overview

**Mosaic** is an open-source, AI-powered coding agent designed for terminal and web-based development workflows. It combines:
- A **React-based TUI** (Terminal User Interface) using OpenTUI.
- A **tool-driven agent architecture** for interacting with codebases, files, and shell commands.
- A **web UI** served by Bun for browser-based workflows.
- **MCP server integration** for external tools (including the native navigation server).
- **Multi-provider AI support** (OpenAI, Anthropic, Google, Mistral, xAI, Ollama, OpenRouter).

### Key Features
- **Terminal-first workflow**: Optimized for CLI usage with React-powered TUI.
- **Project context awareness**: Uses `MOSAIC.md` files to understand project structure and conventions.
- **Safe tool execution**: Requires user approval for write/edit/bash operations.
- **Slash commands**: Quick actions like `/init`, `/web`, `/help`, `/provider`, `/model`.
- **MCP integration**: Configurable external tools with approval policies.
- **Multi-provider AI**: Supports cloud and local models via the Vercel AI SDK.

### Primary Use Cases
- Codebase exploration and understanding.
- Automated code refactoring and bug fixes.
- Project initialization and configuration.
- Shell command execution with safety checks.
- MCP tool orchestration for external integrations.

---

## 2. Architecture

### High-Level Architecture
Mosaic follows a **modular, tool-driven architecture** with the following key components:

1. **Agent Core** (`src/agent/`)
   - Manages the AI agent's state, reasoning, and tool execution.
   - Handles provider-specific integrations (OpenAI, Anthropic, etc.).
   - Coordinates tool execution and user approvals.

2. **Tool Registry** (`src/agent/tools/`)
   - Provides safe, focused capabilities to the agent (e.g., `read`, `write`, `edit`, `bash`).
   - Tools are exposed to the agent via the **Model Context Protocol (MCP)**.

3. **MCP (Model Context Protocol)** (`src/mcp/`)
   - Defines a standardized interface for tools and servers.
   - Manages tool discovery, approval policies, and process lifecycle.
   - Enables dynamic tool registration and execution.

4. **TUI (Terminal UI)** (`src/components/`)
   - Built with **React** and **OpenTUI** for terminal rendering.
   - Provides interactive panels for chat, approvals, and questions.

5. **Web UI** (`src/web/`)
   - Browser-based alternative to the TUI.
   - Built with React and served via a Bun-powered web server.

6. **Web Server** (`src/web/server.tsx`)
   - Serves the web UI bundle and exposes API endpoints for agent interactions.
   - Bridges approvals/questions between the web UI and agent runtime.

7. **Utilities** (`src/utils/`)
   - Shared helpers for configuration, debugging, and file operations.
   - Bridges between the TUI, web UI, and agent core.

### Key Design Patterns
- **Tool-Driven Development**: The agent interacts with the codebase via discrete, safe tools (e.g., `read`, `edit`, `bash`).
- **User Approval Workflow**: Write/edit operations require explicit user approval before execution.
- **Project Context**: Uses `MOSAIC.md` files to understand project structure and conventions.
- **Multi-Provider AI**: Abstracts AI providers behind a unified interface (Vercel AI SDK).
- **MCP Tool Catalog**: Merges internal tools with MCP server tools and enforces approval policies.
- **Modular Tooling**: Tools are dynamically registered and executed via MCP.

### Technology Stack
| Category          | Technologies                                                                 |
|-------------------|------------------------------------------------------------------------------|
| **Runtime**       | Bun (required), Node.js >= 18                                                |
| **Language**      | TypeScript                                                                   |
| **UI**            | React, OpenTUI (TUI), React (Web)                                            |
| **AI**            | Vercel AI SDK, OpenAI, Anthropic, Google, Mistral, xAI, Ollama, OpenRouter   |
| **Database**      | Better-SQLite3 (for tool registry and state)                                 |
| **Web Scraping**  | Linkedom, Mozilla Readability                                                |
| **Markdown**      | React-Markdown, Remark-GFM                                                   |
| **Testing**       | Playwright (for web UI tests)                                                |

---

## 3. Development Guidelines

### Coding Standards
- **TypeScript**: Strong typing is enforced. Use `interface` or `type` for all public APIs.
- **Error Handling**: Prefer throwing descriptive errors over silent failures.
- **Immutability**: Use `const` and immutable patterns where possible.
- **Naming Conventions**:
  - Use `camelCase` for variables and functions.
  - Use `PascalCase` for types, interfaces, and classes.
  - Use `UPPER_CASE` for constants.
  - Prefix private methods with `_`.
- **File Structure**: Group related files in directories (e.g., `src/agent/tools/`).
- **Approval-first UX**: Any write/edit/bash tool must route through the approval workflow.

### Best Practices
- **Tool Safety**: All tools must validate inputs and handle errors gracefully.
- **User Approval**: Write/edit operations must require user approval.
- **Project Context**: Always check for `MOSAIC.md` to understand project conventions.
- **Performance**: Optimize for terminal responsiveness (e.g., avoid blocking operations).
- **Debug Logging**: Use `debugLog` in `src/utils/debug.ts` for lifecycle traces and crash logs.
- **Documentation**: Document public APIs and tool behaviors in code comments.

### Tool Development
- **Tool Definition**: Tools must implement the `McpToolInfo` interface (see `src/mcp/types.ts`).
- **Approval Policy**: Tools must specify their risk level (e.g., `low`, `medium`, `high`) and respect MCP approval modes.
- **Idempotency**: Tools should be idempotent where possible (e.g., `read`, `glob`).
- **Error Handling**: Tools must return descriptive errors for the agent to handle.
- **Tool Catalog**: Internal tools live in `src/agent/tools/definitions.ts` and are merged with MCP tools at runtime.

### Testing
- **Unit Tests**: Test individual functions and tools in isolation.
- **Integration Tests**: Test tool interactions and agent workflows.
- **E2E Tests**: Use Playwright to test the web UI and TUI workflows.

---

## 4. Key Files & Directories

### Root Files
| File/Directory       | Purpose                                                                                     |
|----------------------|---------------------------------------------------------------------------------------------|
| `package.json`       | Project metadata, dependencies, and scripts.                                                |
| `README.md`          | User-facing documentation.                                                                  |
| `tsconfig.json`      | TypeScript configuration (strict, noEmit, bundler resolution).                              |
| `bin/mosaic.cjs`     | CLI entry point (checks Bun, launches `src/index.tsx`).                                      |
| `docs/`              | Project documentation and assets.                                                           |
| `script/`            | Build and utility scripts.                                                                  |
| `benchmark/`         | Benchmarks and reasoning suites.                                                            |

### Source Code (`src/`)
| Directory/File               | Purpose                                                                                     |
|------------------------------|---------------------------------------------------------------------------------------------|
| `agent/`                     | Agent core, tools, and provider integrations.                                               |
| `agent/Agent.ts`             | Main agent class and state management.                                                      |
| `agent/prompts/`             | System and tools prompts for the agent.                                                     |
| `agent/tools/`               | Individual tools (e.g., `read`, `edit`, `bash`).                                            |
| `agent/provider/`            | AI provider integrations (OpenAI, Anthropic, etc.).                                         |
| `mcp/`                       | Model Context Protocol implementation and server registry.                                  |
| `mcp/cli/`                   | MCP CLI commands (list/add/doctor/tools).                                                   |
| `mcp/servers/navigation/`    | Native navigation MCP server.                                                               |
| `mcp/processManager.ts`      | Manages tool processes and lifecycle.                                                       |
| `mcp/toolCatalog.ts`         | Dynamic tool registration and discovery.                                                    |
| `mcp/approvalPolicy.ts`      | Defines tool risk levels and approval requirements.                                         |
| `components/`                | TUI components (React + OpenTUI).                                                           |
| `components/main/`           | Core TUI components (e.g., `ChatPage`, `ApprovalPanel`).                                     |
| `web/`                       | Web UI components and server.                                                               |
| `web/app.tsx`                | Web UI entry point.                                                                         |
| `web/server.tsx`             | Bun web server, API bridge, and TUI streaming.                                              |
| `web/router.ts`              | Client-side routing for the web UI.                                                         |
| `utils/`                     | Shared utilities and helpers.                                                               |
| `utils/config.ts`            | Configuration management (providers, models, API keys).                                     |
| `utils/commands/`            | Slash command implementations (e.g., `/init`, `/web`, `/provider`, `/model`).                |

### Configuration
| File/Directory               | Purpose                                                                                     |
|--------------------------------|---------------------------------------------------------------------------------------------|
| `~/.mosaic/mosaic.jsonc`      | Global configuration (providers, models, API keys, settings).                               |
| `~/.mosaic/mcp/`              | MCP server configs and logs (global).                                                       |
| `.mosaic/`                    | Project-specific configuration (created via `/init`).                                       |
| `MOSAIC.md`                   | Project context for AI agents (created via `/init`).                                        |

---

## 5. Common Tasks

### Initializing a Project
1. Run `mosaic` in the project directory.
2. Use the `/init` command to create:
   - `MOSAIC.md` (project context for AI agents).
   - `.mosaic/` (project-specific settings).

### Adding a New Tool
1. Create a new file in `src/agent/tools/` (e.g., `newTool.ts`).
2. Implement the tool logic and define its `McpToolInfo`:
   ```ts
   export const newTool: McpToolInfo = {
     id: 'newTool',
     description: 'Description of the tool.',
     risk: 'low', // or 'medium', 'high'
     parameters: {
       type: 'object',
       properties: {
         param1: { type: 'string', description: 'Description of param1.' },
       },
       required: ['param1'],
     },
   };
   ```
3. Register the tool in `src/agent/tools/index.ts`.
4. Test the tool in the TUI or web UI.

### Adding a New AI Provider
1. Create a new provider file in `src/agent/provider/` (e.g., `newProvider.ts`).
2. Implement the provider integration using the Vercel AI SDK.
3. Register the provider in `src/utils/config.ts` (add to `AI_PROVIDERS`).
4. Test the provider in the TUI or web UI.

### Running the TUI
- Start the TUI: `bun run dev` (watch) or `bun run start`.
- Use slash commands (e.g., `/help`, `/web`, `/provider`, `/model`, `/approvals`).
- Interact with the agent via chat.

### Running the Web UI
1. Start the web server: `mosaic web` (or `/web` inside the TUI).
2. Open `http://127.0.0.1:8192` in a browser.
3. Interact with the agent via the web interface.

### Managing MCP Servers
- List servers: `mosaic mcp list`
- Add a server: `mosaic mcp add`
- Inspect tools: `mosaic mcp tools [serverId]`
- Diagnostics: `mosaic mcp doctor`

### Switching Providers and Models
- List providers: `/provider`
- Switch provider: `/provider <id>`
- List models: `/model`
- Switch model: `/model <id>`

### Approval Mode
- Toggle approvals: `/approvals on|off|toggle|status`
- Turning approvals off auto-approves pending tool requests.

### Testing Tools
1. Use the TUI or web UI to test tools interactively.
2. Write unit tests in `src/agent/tools/__tests__/` (if present).
3. Run tests: `bun test` or `npm test`.

### Debugging
- Debug logs are appended to `~/.mosaic/debug.log` via `src/utils/debug.ts`.
- Check the terminal or browser console for errors.
- Use the `/echo` command to test agent responses.

---

## Notes for AI Agents
- **Project Context**: Always check for `MOSAIC.md` to understand project-specific conventions.
- **Tool Safety**: Never execute write/edit/bash operations without user approval.
- **User Approval**: Always show a preview of changes before applying them.
- **Error Handling**: Provide clear, actionable error messages to users.
- **Performance**: Optimize for terminal responsiveness (e.g., avoid long-running operations).
- **Web UI Bridge**: The web server proxies approvals/questions between the agent and browser UI.