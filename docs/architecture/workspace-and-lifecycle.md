# Workspace Aggregation And Lifecycle

## Repository scan

`src/agent/repoScan.ts` builds a deterministic workspace summary:

- manifests
- entrypoints
- top-level directories
- command hints
- project roots

The summary is intentionally shallow and cacheable so the agent does not need to recursively rediscover the workspace on every task.

## Git workspace aggregation

`src/agent/gitWorkspaceState.ts` turns a few read-only git commands into structured state:

- current and upstream branch
- ahead/behind counts
- modified, added, deleted, renamed, untracked counts
- key changed paths
- remotes

The same module also recognizes read-only git inspection commands so they can stay on the low-risk side of approvals and context summarization.

## Context findings

`src/agent/contextCompiler.ts` extracts:

- latest plan steps
- current working set
- recent successful tool findings
- open failures or unknowns

This gives the model a compact state-of-work summary without replaying the full raw tool ledger.

## Lifecycle hooks

`src/agent/lifecycle.ts` exposes a small stage-based hook system:

- `pre_run`
- `post_edit`
- `post_verify`
- `end_task`

The hook surface is intentionally small. It is meant for product-level task lifecycle integration, not arbitrary plugin execution.
