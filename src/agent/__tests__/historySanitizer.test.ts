import { describe, expect, it } from 'bun:test';
import { sanitizeHistory } from '../historySanitizer';
import type { CoreMessage } from 'ai';

describe('historySanitizer', () => {
  it('should remove empty content messages', () => {
    const history: CoreMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'world' },
      { role: 'assistant', content: [] as any },
    ];
    
    const sanitized = sanitizeHistory(history);
    expect(sanitized.length).toBe(2);
    expect(sanitized[0]?.content).toBe('hello');
    expect(sanitized[1]?.content).toBe('world');
  });

  it('should prevent consecutive assistant messages', () => {
    const history: CoreMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'thinking...' },
      { role: 'assistant', content: 'actually here is the answer' },
    ];
    
    const sanitized = sanitizeHistory(history);
    expect(sanitized.length).toBe(2);
    expect(sanitized[1]?.content).toBe('thinking...');
  });

  it('should handle tool results correctly', () => {
    const history: CoreMessage[] = [
      { role: 'user', content: 'run ls' },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'bash', toolCallId: '1', args: { command: 'ls' } }] as any },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'bash', toolCallId: '1', result: 'file1' }] as any },
    ];
    
    const sanitized = sanitizeHistory(history);
    expect(sanitized.length).toBe(3);
  });
});
