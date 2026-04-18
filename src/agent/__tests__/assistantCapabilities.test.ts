import { describe, expect, it } from 'bun:test';
import { buildAssistantCapabilitySummary, type AssistantCapabilitySnapshot } from '../assistantCapabilities';

describe('assistant capability summary', () => {
  it('builds a truthful local summary from the provided snapshot', () => {
    const snapshot: AssistantCapabilitySnapshot = {
      lightweightRoute: {
        provider: 'openai',
        model: 'gpt-5.4-mini',
      },
      approvalsEnabled: true,
      modes: [
        { mode: 'chat', label: 'Chat', purpose: 'Small-talk only.' },
        { mode: 'assistant_capabilities', label: 'Assistant Capabilities', purpose: 'Capability introspection.' },
      ],
      internalToolNames: ['bash', 'read', 'write'],
      mcpToolNames: ['mcp__github__fetch_pr'],
      activeSkills: ['global-coding-assistant', 'playwright'],
      oneShotSkillIds: ['slides'],
    };

    const summary = buildAssistantCapabilitySummary(snapshot);

    expect(summary).toContain('openai/gpt-5.4-mini');
    expect(summary).toContain('Assistant Capabilities (assistant_capabilities)');
    expect(summary).toContain('Internal tools (3): bash, read, write');
    expect(summary).toContain('MCP tools (1): mcp__github__fetch_pr');
    expect(summary).toContain('Active workspace skills (2): global-coding-assistant, playwright');
    expect(summary).toContain('One-shot queued skills (1): slides');
    expect(summary).toContain('no repo scan, no workspace summary');
  });
});
