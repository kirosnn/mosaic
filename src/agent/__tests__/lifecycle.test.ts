import { describe, expect, it } from 'bun:test';
import { registerTaskLifecycleHook, runTaskLifecycleStage } from '../lifecycle';

describe('task lifecycle hooks', () => {
  it('runs hooks in registration order for the requested stage', async () => {
    const calls: string[] = [];

    registerTaskLifecycleHook('post_verify', async () => {
      calls.push('first');
    });
    registerTaskLifecycleHook('post_verify', async () => {
      calls.push('second');
    });

    await runTaskLifecycleStage('post_verify', {
      changedPaths: ['README.md'],
    });

    expect(calls).toEqual(['first', 'second']);
  });
});
