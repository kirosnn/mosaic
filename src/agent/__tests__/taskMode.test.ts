import { describe, expect, it } from 'bun:test';
import { detectTaskMode } from '../taskMode';

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

  it('keeps repository questions out of assistant capability mode', () => {
    const decision = detectTaskMode([
      { role: 'user', content: 'Quels outils sont utilisés dans ce repo ?' },
    ]);

    expect(decision.mode).toBe('explore_readonly');
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
