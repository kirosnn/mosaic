import { describe, expect, it } from 'bun:test';
import { compileContextSnapshot } from '../contextCompiler';

describe('context snapshot compilation', () => {
  it('keeps read-only git bash output out of key findings but preserves failures as unknowns', () => {
    const result = compileContextSnapshot(
      [
        { role: 'user', content: 'Review the repository state and release packaging.' },
        {
          role: 'tool',
          content: '',
          toolName: 'bash',
          toolArgs: { command: 'git status --short --branch' },
          toolResult: '## main...origin/main\n M README.md',
          success: true,
        },
        {
          role: 'tool',
          content: '',
          toolName: 'read',
          toolArgs: { path: 'README.md' },
          toolResult: 'Mosaic is Bun-first.',
          success: true,
        },
        {
          role: 'tool',
          content: '',
          toolName: 'write',
          toolArgs: { path: 'CHANGELOG.md' },
          toolResult: 'Permission denied',
          success: false,
        },
      ],
      {
        mode: 'review',
        confidence: 'high',
        reason: 'review language detected',
        latestUserRequest: 'Review the repository state and release packaging.',
      },
      {
        workspaceRoot: '/repo',
        generatedAt: Date.now(),
        projectRoots: [{ path: '.', markers: ['.git'], manifests: ['package.json'], entrypoints: ['src/app/cli/main.tsx'], topLevelDirectories: ['src', 'docs'] }],
        manifests: ['package.json', 'bun.lock'],
        dependencyManifests: ['package.json'],
        architectureFiles: ['README.md'],
        importantFiles: ['package.json', 'README.md', 'src/app/cli/main.tsx'],
        entrypoints: ['src/app/cli/main.tsx'],
        topLevelDirectories: ['src', 'docs'],
        commands: { install: ['bun install'], dev: ['bun run dev'], build: [], test: ['bun test'], lint: ['bun run lint'] },
        cacheHit: false,
      },
      4000,
      {
        isGitRepository: true,
        currentBranch: 'main',
        upstreamBranch: 'origin/main',
        aheadCount: 0,
        behindCount: 0,
        modifiedCount: 1,
        addedCount: 0,
        deletedCount: 0,
        renamedCount: 0,
        untrackedCount: 0,
        keyChangedPaths: ['README.md'],
        remotes: [{ name: 'origin' }],
        branchTrackingInfo: [],
      },
    );

    expect(result.text).toContain('Task mode: Review');
    expect(result.text).toContain('Git workspace:');
    expect(result.text).toContain('[read] Mosaic is Bun-first.');
    expect(result.text).toContain('Open unknowns:');
    expect(result.text).toContain('write: Permission denied');
    expect(result.text).not.toContain('[bash] ## main...origin/main');
  });
});
