# Providers And MCP Integration

## Provider abstraction

The runtime normalizes provider behavior behind the `Provider` interface in `src/agent/types.ts`.

Each provider implementation is responsible for:

- streaming text/reasoning deltas
- tool call emission
- tool result continuation
- finish and error events
- provider-specific retries and auth quirks

Main implementations live under `src/agent/provider/`.

## Why providers differ

Mosaic has a common event model, but provider backends are not equivalent.

Examples:

- OpenAI handles API-key and OAuth flows differently
- Google OAuth uses Code Assist-specific behavior
- Groq uses a dedicated tool-calling adapter
- Ollama must manage local/cloud reachability and model availability

The support matrix should stay aligned with those differences instead of flattening them in docs.

## MCP integration

MCP runtime code lives in `src/mcp/`.

Main responsibilities:

- cataloging available MCP tools
- server process management
- CLI management commands
- approval/risk policy
- schema conversion and registry handling

At runtime, MCP tools are merged into the callable tool surface for non-lightweight tasks.

## Boundary rule

Task-mode routing and repo context should stay independent from MCP availability.

Mosaic should still route correctly when MCP is disabled, unavailable, or partially configured.
