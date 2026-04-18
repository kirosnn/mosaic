import { describe, expect, it } from 'bun:test';
import { classifyShellCapability } from '../capabilities';

describe('shell capability classification', () => {
  it('auto-allows safe compound read-only git chains', () => {
    const capability = classifyShellCapability(
      'git status --short --branch; git remote -v; git branch -vv',
      false,
    );

    expect(capability).toBe('shell_read_only');
  });

  it('keeps mixed shell chains out of read-only classification', () => {
    const capability = classifyShellCapability(
      'git status --short --branch; git add .',
      false,
    );

    expect(capability).toBe('destructive');
  });

  it('recognizes read-only rev-list inspection chains behind logical separators', () => {
    const capability = classifyShellCapability(
      'git branch --show-current && git rev-list --left-right --count HEAD...origin/main',
      false,
    );

    expect(capability).toBe('shell_read_only');
  });
});
