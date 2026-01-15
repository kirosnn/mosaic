import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ConversationStep {
  type: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  timestamp: number;
}

export interface ConversationHistory {
  id: string;
  timestamp: number;
  steps: ConversationStep[];
  totalSteps: number;
  totalTokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  model?: string;
  provider?: string;
}

export function getHistoryDir(): string {
  const configDir = join(homedir(), '.mosaic');
  const historyDir = join(configDir, 'history');

  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }

  return historyDir;
}

export function saveConversation(conversation: ConversationHistory): void {
  const historyDir = getHistoryDir();
  const filename = `${conversation.id}.json`;
  const filepath = join(historyDir, filename);

  writeFileSync(filepath, JSON.stringify(conversation, null, 2), 'utf-8');
}

export function loadConversations(): ConversationHistory[] {
  const historyDir = getHistoryDir();

  if (!existsSync(historyDir)) {
    return [];
  }

  const files = readdirSync(historyDir).filter(f => f.endsWith('.json'));
  const conversations: ConversationHistory[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(historyDir, file), 'utf-8');
      conversations.push(JSON.parse(content));
    } catch (error) {
      console.error(`Failed to load ${file}:`, error);
    }
  }

  return conversations.sort((a, b) => b.timestamp - a.timestamp);
}

export function getInputHistory(): string[] {
  const historyDir = getHistoryDir();
  const inputHistoryPath = join(historyDir, 'inputs.json');

  if (!existsSync(inputHistoryPath)) {
    return [];
  }

  try {
    const content = readFileSync(inputHistoryPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return [];
  }
}

export function saveInputHistory(history: string[]): void {
  const historyDir = getHistoryDir();
  const inputHistoryPath = join(historyDir, 'inputs.json');

  writeFileSync(inputHistoryPath, JSON.stringify(history, null, 2), 'utf-8');
}

export function addInputToHistory(input: string): void {
  if (!input.trim()) return;

  const history = getInputHistory();

  if (history[history.length - 1] !== input) {
    history.push(input);

    if (history.length > 100) {
      history.shift();
    }

    saveInputHistory(history);
  }
}