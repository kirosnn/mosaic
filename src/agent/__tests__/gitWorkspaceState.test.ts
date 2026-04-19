import { describe, expect, it } from 'bun:test';
import {
  collectGitWorkspaceStateFromCaptures,
  formatGitWorkspaceSummary,
  isReadOnlyGitInspectionCommand,
} from '../gitWorkspaceState';

describe('git workspace aggregation', () => {
  it('aggregates branch, remote, change, and ahead/behind state from read-only captures', () => {
    const state = collectGitWorkspaceStateFromCaptures([
      {
        command: 'git status --short --branch',
        output: '## feat/release-pass...origin/feat/release-pass [ahead 2, behind 1]\n M README.md\nA  docs/release-process.md\nR  old.ts -> src/app/cli/main.tsx\n?? CHANGELOG.md\n',
      },
      {
        command: 'git remote -v',
        output: 'origin\thttps://github.com/kirosnn/mosaic (fetch)\norigin\thttps://github.com/kirosnn/mosaic (push)\n',
      },
      {
        command: 'git branch -vv --no-color',
        output: '* feat/release-pass 1234567 [origin/feat/release-pass: ahead 2, behind 1] release cleanup\n  main 89abcde [origin/main] baseline\n',
      },
      {
        command: 'git rev-list --left-right --count HEAD...@{upstream}',
        output: '1 2\n',
      },
    ]);

    expect(state.isGitRepository).toBe(true);
    expect(state.currentBranch).toBe('feat/release-pass');
    expect(state.upstreamBranch).toBe('origin/feat/release-pass');
    expect(state.behindCount).toBe(1);
    expect(state.aheadCount).toBe(2);
    expect(state.modifiedCount).toBe(1);
    expect(state.addedCount).toBe(1);
    expect(state.renamedCount).toBe(1);
    expect(state.untrackedCount).toBe(1);
    expect(state.keyChangedPaths).toContain('README.md');
    expect(state.keyChangedPaths).toContain('src/app/cli/main.tsx');
    expect(state.remotes[0]?.name).toBe('origin');
  });

  it('formats a compact summary and recognizes read-only git inspection commands', () => {
    const summary = formatGitWorkspaceSummary({
      isGitRepository: true,
      currentBranch: 'main',
      upstreamBranch: 'origin/main',
      aheadCount: 0,
      behindCount: 0,
      modifiedCount: 2,
      addedCount: 1,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 3,
      keyChangedPaths: ['README.md', 'docs/provider-support.md'],
      remotes: [{ name: 'origin' }],
      branchTrackingInfo: [],
    });

    expect(summary).toContain('Current branch: main');
    expect(summary).toContain('Changes: modified=2, added=1');
    expect(isReadOnlyGitInspectionCommand('git status --short --branch')).toBe(true);
    expect(isReadOnlyGitInspectionCommand('git add README.md')).toBe(false);
  });
});
