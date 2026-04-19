# Changelog

All notable changes to Mosaic should be recorded here.

The format is intentionally lightweight:

- keep one `Unreleased` section for pending work
- cut a new version section at release time
- group notes by user-facing impact, not commit history

## Unreleased

### Repository and distribution

- clarified Mosaic as a Bun-first product and contributor workflow
- defined `bun.lock` as the repository source of truth
- reduced the published package surface to the CLI/runtime files required for end users
- added release process documentation and GitHub workflows for CI and tagged releases

### Architecture and docs

- introduced `src/app` as the explicit entrypoint layer for CLI and Electron launch surfaces
- added maintainer-facing architecture docs for task routing, runtime context, providers, MCP, and repository boundaries
- documented the provider support matrix with explicit caveats

### Quality

- expanded behavior-level coverage for task routing, context compilation, git workspace aggregation, lifecycle hooks, and package-manager command hints
