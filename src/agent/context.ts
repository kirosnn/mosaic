import { CoreMessage, CoreTool } from 'ai';
import { AgentConfig, AgentContext } from './types';

export class AgentContextManager {
  private messages: CoreMessage[] = [];
  private systemPrompt: string;
  private tools: Record<string, CoreTool>;
  private config: AgentConfig;
  private currentStep: number = 0;

  constructor(
    systemPrompt: string,
    tools: Record<string, CoreTool>,
    config: AgentConfig,
    initialMessages: CoreMessage[] = []
  ) {
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.config = config;
    this.messages = [...initialMessages];
  }

  addMessage(message: CoreMessage): void {
    this.messages.push(message);
  }

  addUserMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content,
    });
  }

  addAssistantMessage(content: string): void {
    this.messages.push({
      role: 'assistant',
      content,
    });
  }

  addToolResult(toolCallId: string, toolName: string, result: unknown): void {
    this.messages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          result,
        },
      ],
    });
  }

  getMessages(): CoreMessage[] {
    return [...this.messages];
  }

  getContext(): AgentContext {
    return {
      messages: this.getMessages(),
      systemPrompt: this.systemPrompt,
      tools: this.tools,
      config: this.config,
    };
  }

  incrementStep(): void {
    this.currentStep++;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  getMaxSteps(): number {
    return this.config.maxSteps || 10;
  }

  canContinue(): boolean {
    return this.currentStep < this.getMaxSteps();
  }

  reset(): void {
    this.messages = [];
    this.currentStep = 0;
  }

  getLastMessage(): CoreMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  getMessageCount(): number {
    return this.messages.length;
  }
}