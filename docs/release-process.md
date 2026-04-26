# Release Process

## Goals

- publish a versioned npm package with a predictable Bun runtime story
- ship release notes that explain user-visible changes
- keep distribution artifacts limited to the supported CLI/runtime surface

## Versioning

Mosaic uses semantic versioning.

- patch: bug fixes, docs-only release-surface fixes, targeted runtime regressions
- minor: new capabilities, new supported providers, substantial repo/runtime improvements without intentional breakage
- major: intentional breaking changes in CLI behavior, config shape, packaging, or provider contracts

## Release checklist

1. Update `package.json` version.
2. Move the `Unreleased` notes in `CHANGELOG.md` into a versioned section.
3. Run:

```bash
bun install
bun run lint
bun test
npm pack --dry-run --cache ./.npm-pack-cache
```

4. Confirm the packed artifact contains only the intended runtime surface.
5. Create a git tag matching the version, for example `v0.8.1`.
6. Push the tag and publish the GitHub release notes from `CHANGELOG.md`.
7. Publish the npm package from the tagged commit.

## Distribution policy

- the npm package is the distribution channel
- Bun is the required runtime for Mosaic itself

## Release notes guidance

Each release should cover:

- install/runtime changes
- new or changed provider support
- agent/runtime behavior changes
- compatibility notes or caveats
