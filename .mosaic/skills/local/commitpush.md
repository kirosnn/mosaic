---
id: commitpush
title: commitpush
tags: ["git", "automation", "quality"]
priority: 50
requires: []
modelHints:
  prefers_small_commits: true
  commit_style: "single-file commits"
summary: "Commit each changed file with a professional English message and push after validations."
onActivate:
  run: false
  prompt: ""
---

# commitpush

## When to use (trigger conditions)
Use this skill when:
- You have a working tree with changes and you want **one commit per file**.
- You want commit messages in **professional English** starting with one of:
  - `fix:`, `feat:`, `add:`, `modif:`, `del:`
- You want to **validate the project** (lint/tests/build as appropriate) **before committing**.
- You want to **push after all commits** are created successfully.

Do NOT use this skill when:
- The repository is in the middle of a rebase/merge conflict.
- There are untracked secrets/credentials or generated artifacts that shouldn’t be committed.
- The project validations cannot be run (missing deps/toolchain) and you can’t reasonably fix that first.

---

## Execution workflow (concrete steps)

### 0) Safety pre-checks
1. Ensure you are inside a git repository.
2. Ensure there is no ongoing merge/rebase:
   - Check for `.git/MERGE_HEAD` or `.git/rebase-apply` / `.git/rebase-merge`.
3. Fetch status and collect:
   - staged files
   - unstaged files
   - untracked files
4. Determine current branch and remote tracking status.

If there are conflicts or rebase/merge in progress: **stop** and ask to resolve first.

---

### 1) Determine project-type validations (auto-detect)
Detect the project stack by presence of files (highest priority first):
- Node: `package.json`
- Bun: `bun.lockb`
- PNPM: `pnpm-lock.yaml`
- Yarn: `yarn.lock`
- Python: `pyproject.toml` or `requirements.txt`
- Rust: `Cargo.toml`
- Go: `go.mod`
- Java/Gradle: `build.gradle` / `gradlew`
- Maven: `pom.xml`
- .NET: `*.sln` / `*.csproj`
- PHP: `composer.json`

Then pick the best available validation commands (only those that exist in scripts/config):
- For Node/Bun:
  - Prefer `lint`, then `test`, then `build` if present in `package.json` scripts.
- For Python:
  - If `pytest` present: run tests
  - If `ruff`/`flake8` present: run lint
- For Rust:
  - `cargo fmt --check` (if rustfmt available), `cargo clippy` (if available), `cargo test`
- For Go:
  - `go test ./...` and `gofmt` check
- For Java:
  - `./gradlew test` or `mvn test` (depending on wrapper presence)
- For .NET:
  - `dotnet test`

Rule: validations must be **green** before any commit. If they fail, fix first, then re-run.

---

### 2) Prepare commit plan (one commit per file)
1. Build a list of files to commit:
   - Include tracked modified files (staged + unstaged).
   - Include new files only if they are intended (confirm by .gitignore and common generated folders).
2. Sort deterministically:
   - Prefer smaller/safer files first (docs/config), then code.
3. For each file, decide commit prefix:
   - `feat:` new feature behavior (user-facing or API)
   - `fix:` bug fix
   - `add:` adding a non-feature file or capability (docs, config, tooling)
   - `modif:` refactor/adjust behavior without being clearly feat/fix
   - `del:` removing files or functionality

---

### 3) Commit each file individually
For each file `F` in plan:

1. Ensure working tree still matches expectations (no new surprise files).
2. Stage only that file:
   - `git add -- "F"`
3. Verify project still passes validations (see constraints for optimization):
   - Run full validations on first commit.
   - Then run targeted/fast validations if available; if not, run the same validations each time.
4. Create commit message in professional English:
   - Format:
     - `<prefix> <short imperative summary>`
     - blank line
     - optional detail bullets (if needed)
     - blank line
     - `Co-authored-by: <NAME> <EMAIL>`
   - The summary must mention the file’s intent, not the filename.
   - Keep first line ideally <= 72 chars.

5. Commit:
   - `git commit -m "<prefix> ...summary..." -m "Co-authored-by: <NAME> <EMAIL>"`

If commit fails, stop immediately and report why.

---

### 4) Final verification + push
1. Run validations one last time on the full repo state.
2. Ensure branch has an upstream; if not, set it:
   - `git push -u origin <branch>`
3. Push:
   - `git push`

---

## Constraints (boundaries and safety constraints)

### Git safety
- Never commit:
  - secrets (keys, tokens, .env with real creds)
  - large binaries unless the repo uses LFS intentionally
  - generated build outputs unless the project policy requires it
- Never amend or force-push unless explicitly requested.
- Never create commits during merge/rebase conflicts.

### Commit policy
- Exactly **one file per commit**:
  - Stage only one file at a time.
  - If a change logically spans multiple files, still follow one-file commits unless user says otherwise.
- Commit message must start with one of:
  - `fix:`, `feat:`, `add:`, `modif:`, `del:`
- Commit message language: **English**, professional, imperative tone.
- Must append co-author trailer at the end:
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`  
- If user ask you to do in another way or remove the co-author, do it.

### Validation policy
- Must run and pass validations appropriate to the project before committing.
- If no validation tooling is detectable, at minimum:
  - `git diff --check`
  - basic build command if known
- If validations are expensive:
  - Full run before first commit and before final push.
  - Between commits: run the fastest equivalent (lint or targeted tests) if available.

### Operational constraints
- Works on Windows/macOS/Linux; prefer cross-platform commands.
- Use `--` in git paths to avoid path injection issues: `git add -- "path"`.

---

## Suggested default commands (implementation notes)

### Detect scripts (Node/Bun)
- Read `package.json` scripts:
  - If `bun.lockb`: prefer `bun run <script>`
  - Else if `pnpm-lock.yaml`: `pnpm run <script>`
  - Else if `yarn.lock`: `yarn <script>`
  - Else: `npm run <script>`

### Minimal validation fallback
- `git diff --check`
- `git status --porcelain`

---

## Example commit messages

- `fix: prevent crash when input is empty`
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`

- `feat: support multiple profiles in settings`
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`

- `add: document local development workflow`
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`

- `modif: simplify request parsing logic`
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`

- `del: remove deprecated debug endpoint`
  - `Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic`
