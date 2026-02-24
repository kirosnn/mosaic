---
id: commitpush
title: commitpush
tags: ["git", "automation", "quality"]
priority: 50
requires: []
modelHints:
  prefers_small_commits: true
  commit_style: "single-file commits"
summary: "Commit each changed file with a professional English message and push directly without running tests."
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
- You want to commit and push **without running tests/lint/build**.
- You want to **push after all commits** are created successfully.

Do NOT use this skill when:
- The repository is in the middle of a rebase/merge conflict.
- There are untracked secrets/credentials or generated artifacts that shouldn’t be committed.
- You need mandatory validations to run before commit.

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

### 1) Validation behavior
Do not run project validations by default:
- Do not run `test`, `lint`, `build`, or language-specific validation commands.
- Do not block commits on validation status.
- Only run validations if the user explicitly asks for it in the current request.

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
3. Do not run validation commands unless explicitly requested by the user.
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
1. Ensure branch has an upstream; if not, set it:
   - `git push -u origin <branch>`
2. Push:
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
- Do not run tests, lint, build, or other validations by default.
- If the user explicitly requests validations, run only the commands requested.

### Operational constraints
- Works on Windows/macOS/Linux; prefer cross-platform commands.
- Use `--` in git paths to avoid path injection issues: `git add -- "path"`.

---

## Suggested default commands (implementation notes)

### Git-only execution
- `git status --short`
- `git rev-parse --abbrev-ref HEAD`
- `git add -- "path"`
- `git commit -m "<prefix> <summary>" -m "Co-authored-by: Mosaic | https://github.com/kirosnn/mosaic"`
- `git push -u origin <branch>` (if no upstream)
- `git push`

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
