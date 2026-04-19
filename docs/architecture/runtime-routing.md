# Task Modes And Runtime Context

## Why task modes exist

Mosaic should not pay the full repository-context cost for every message.

The runtime first classifies the latest user turn into one of these modes:

- `chat`
- `assistant_capabilities`
- `explore_readonly`
- `plan`
- `edit`
- `run`
- `review`

## Routing flow

1. Heuristic routing starts in `src/agent/taskMode.ts`.
2. If model-based routing is enabled, `src/agent/taskModeModel.ts` can refine the decision.
3. `src/agent/runtimeContext.ts` decides whether the request stays lightweight or requires repo-aware context.

## Lightweight paths

Two modes bypass repository scan and git aggregation entirely:

- `chat`: greetings, acknowledgements, trivial small-talk
- `assistant_capabilities`: questions about Mosaic itself, not the workspace

These paths exist to reduce latency and token usage.

## Repo-aware paths

For `explore_readonly`, `plan`, `edit`, `run`, and `review`, the runtime builds a context envelope from:

- deterministic repository scan
- git workspace summary
- recent plan state
- working set paths
- recent successful findings
- unresolved failures

This snapshot is assembled in `src/agent/contextCompiler.ts` and inserted into conversation history in `src/agent/context.ts`.

## Lightweight chat vs assistant capabilities

These two modes are intentionally separate:

- lightweight chat should behave like a concise conversational shell and avoid tools
- assistant capabilities should answer only from a local capability snapshot and avoid pretending to know workspace details

The capability snapshot is built in `src/agent/assistantCapabilities.ts`.

## Compaction

Once a conversation exceeds budget, `src/agent/context.ts` compacts older turns into a short assistant summary and preserves recent turns plus the current repo snapshot.

The goal is to preserve product behavior, not verbatim history.
