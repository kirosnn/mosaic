# Repository Layout And Migration Path

## Current target shape

Mosaic is moving toward clearer product layers:

- `src/app`: entrypoints and launch surfaces
- `src/agent`: core runtime
- `src/components`: terminal UI
- `src/mcp`: MCP services and CLI
- `src/utils`: shared helpers and config
- `src/electron`: Electron implementation details

## What changed in this pass

- CLI and Electron launch surfaces now have explicit entrypoints under `src/app`
- contributor docs and README now describe `src/app` as the entrypoint layer
- the published package surface is centered on the CLI/runtime modules instead of the full source tree

## Why this is incremental

The repository already has a functioning runtime. Moving every internal module in one pass would create high merge risk and low product value.

The migration strategy is:

1. move entrypoints first
2. document ownership boundaries
3. move deeper modules only when a product change already touches them

## Practical rules

- new top-level launch surfaces should live in `src/app`
- `src/agent` should stay runtime-focused and UI-agnostic
- `src/components` should not absorb provider or MCP policy logic
- `src/electron` can keep implementation modules until those files need active refactors
