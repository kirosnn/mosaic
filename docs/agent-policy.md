# Agent policy

Mosaic loads its default agent behavior from `src/agent/defaultPolicy.json`.

Create `.mosaic/agent-policy.json` in a workspace to override only the values needed by that project. Set `MOSAIC_AGENT_POLICY` to load a policy from another path.

Configurable sections include:

- title length, greeting detection and fallback labels;
- safety patterns, matching rules and refusal messages;
- denied-operation argument mapping and user-facing messages.

The headless server also supports:

- `MOSAIC_BENCH_HOST`;
- `MOSAIC_BENCH_PORT_START`;
- `MOSAIC_BENCH_PORT_END`;
- `MOSAIC_BENCH_API_PREFIX`;
- `MOSAIC_BENCH_URL` for the benchmark client.

Arrays replace their default value. Objects are merged recursively with the default policy.
