import { describe, expect, it } from 'bun:test';
import { detectTaskMode, shouldUseLightweightEnvironmentHandling } from '../taskMode';

describe('task mode fallback heuristics', () => {
  it('keeps lightweight greetings in chat mode', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Salut' },
    ]);

    expect(decision.mode).toBe('chat');
  });

  it('routes assistant capability questions to assistant_capabilities', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Tu as des skills ?' },
    ]);

    expect(decision.mode).toBe('assistant_capabilities');
    expect(decision.reason).toContain('capability');
  });

  it('routes MCP capability questions to assistant_capabilities', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Tu as des serveurs MCP ?' },
    ]);

    expect(decision.mode).toBe('assistant_capabilities');
  });

  it('keeps repository questions out of assistant capability mode', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Quels outils sont utilisés dans ce repo ?' },
    ]);

    expect(decision.mode).toBe('explore_readonly');
  });

  it('routes machine-level setup requests to environment_config', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Install and configure a local MCP server for my notes app and connect it to a folder on my machine.' },
    ]);

    expect(decision.mode).toBe('environment_config');
    expect(decision.reason).toContain('local machine');
  });

  it('keeps repo configuration requests in repo-centric modes', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Configure the lint setup in this repo and update package.json scripts.' },
    ]);

    expect(decision.mode).toBe('edit');
  });

  it('inherits the recent technical mode for short acknowledgements', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Fix the failing tests in the auth module.' },
      { role: 'assistant', content: 'I am checking the auth tests now.' },
      { role: 'user', content: 'ok' },
    ]);

    expect(decision.mode).toBe('edit');
    expect(decision.reason).toContain('continuation');
  });

  it('inherits explore mode for short acknowledgements after read-only requests', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Show me git status and explain what changed.' },
      { role: 'assistant', content: 'I am reviewing the repository state.' },
      { role: 'user', content: 'ça marche' },
    ]);

    expect(decision.mode).toBe('explore_readonly');
  });

  it('inherits environment_config for short subsystem follow-ups', () => {
    const messages = [
      { role: 'user', content: '/subsystem' },
      { role: 'slash', content: 'Shell subsystem set to WSL (wsl).' },
      { role: 'user', content: 'Et maintenant ?' },
    ];
    const decision = detectTaskMode(messages);

    expect(decision.mode).toBe('environment_config');
    expect(decision.reason).toContain('continuation');
    expect(shouldUseLightweightEnvironmentHandling(messages, decision)).toBe(true);
  });

  it('uses lightweight environment handling for direct subsystem questions', () => {
    const messages = [
      { role: 'user', content: 'Quel est mon subsystem ?' },
    ];
    const decision = detectTaskMode(messages);

    expect(decision.mode).toBe('environment_config');
    expect(shouldUseLightweightEnvironmentHandling(messages, decision)).toBe(true);
  });

  it('keeps complex environment questions out of lightweight handling', () => {
    const messages = [
      { role: 'user', content: 'Explain fallback behavior across sessions for WSL vs pwsh and recommend which one I should use for this repo.' },
    ];
    const decision = detectTaskMode(messages);

    expect(decision.mode).toBe('environment_config');
    expect(shouldUseLightweightEnvironmentHandling(messages, decision)).toBe(false);
  });

  it('routes short questions to explore_readonly instead of edit fallback', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Why is this failing?' },
    ]);

    expect(decision.mode).toBe('explore_readonly');
    expect(decision.reason).toBe('question-shaped request fallback');
  });

  it('routes broader questions to plan instead of edit fallback', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'What is the best approach to migrate this module safely without breaking the current flow?' },
    ]);

    expect(decision.mode).toBe('plan');
    expect(decision.reason).toContain('planning');
  });
});
