# Contributing

## Tooling policy

Mosaic is a Bun-first repository.

- Use `bun install` to install dependencies.
- Use `bun run <script>` for repository scripts.
- Treat `bun.lock` as the source-of-truth lockfile for the main repository.
- Do not reintroduce `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` at the repository root.

`npm` remains a registry distribution channel for the published package. It is not the development package manager for this repository.

## Local workflow

```bash
bun install
bun run lint
bun test
```

Useful commands:

```bash
bun run dev
bun run start
```

## Repository structure

- `src/app`: application entrypoints and launch surfaces
- `src/agent`: agent runtime, prompts, providers, and tools
- `src/components`: terminal UI
- `src/mcp`: MCP runtime and CLI management
- `src/utils`: shared configuration, history, commands, and bridges
- `docs/architecture`: maintainer-facing technical design notes

The current structure is intentionally incremental. New entrypoints should land under `src/app`, while existing deeper modules can move only when the migration stays low-risk.

## Release expectations

- Update `CHANGELOG.md` for user-visible changes.
- Keep README install instructions aligned with the Bun-first policy.
- Run targeted tests for the touched runtime paths before broader validation.
- Avoid broad cleanup unrelated to the product/repository layer you are touching.
