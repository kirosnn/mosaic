import { describe, expect, it } from 'bun:test';
import { detectTaskModeWithModel } from '../taskModeModel';

describe('taskMode routing', () => {
  it('should route subsystem questions to environment_config', async () => {
    process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER = '1';
    const questions = [
      'What subsystem am I using?',
      'Quel est mon subsystem ?',
      'Am I on WSL or PowerShell?',
      'active shell?',
      'which shell are you using for commands?',
    ];

    for (const q of questions) {
      const decision = await detectTaskModeWithModel([{ role: 'user', content: q }]);
      expect(decision.mode).toBe('environment_config');
    }
  });

  it('should route technical questions correctly', async () => {
    process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER = '1';
    const decision = await detectTaskModeWithModel([{ role: 'user', content: 'how does the auth work?' }]);
    expect(decision.mode).toBe('explore_readonly');
  });

  it('should route MCP capability questions to assistant_capabilities', async () => {
    process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER = '1';
    const decision = await detectTaskModeWithModel([{ role: 'user', content: 'Tu as des serveurs MCP ?' }]);
    expect(decision.mode).toBe('assistant_capabilities');
  });
});
