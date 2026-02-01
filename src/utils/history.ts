import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ConversationStep {
  type: 'user' | 'assistant' | 'tool';
  content: string;
  thinkingContent?: string;
  images?: import("./images").ImageAttachment[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  timestamp: number;
  responseDuration?: number;
  blendWord?: string;
}

export interface ConversationHistory {
  id: string;
  timestamp: number;
  steps: ConversationStep[];
  totalSteps: number;
  title?: string | null;
  workspace?: string | null;
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

export function updateConversationTitle(id: string, title: string | null): boolean {
  const historyDir = getHistoryDir();
  const filepath = join(historyDir, `${id}.json`);

  if (!existsSync(filepath)) {
    return false;
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content) as ConversationHistory;
    data.title = title;
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    return false;
  }
}

export function deleteConversation(id: string): boolean {
  const historyDir = getHistoryDir();
  const filepath = join(historyDir, `${id}.json`);

  if (!existsSync(filepath)) {
    return false;
  }

  try {
    unlinkSync(filepath);
    return true;
  } catch (error) {
    return false;
  }
}

export function loadConversations(): ConversationHistory[] {
  const historyDir = getHistoryDir();

  if (!existsSync(historyDir)) {
    return [];
  }

  const files = readdirSync(historyDir).filter(f => f.endsWith('.json') && f !== 'inputs.json');
  const conversations: ConversationHistory[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(historyDir, file), 'utf-8');
      const parsed = JSON.parse(content) as ConversationHistory;
      if (!parsed || !Array.isArray(parsed.steps)) continue;
      conversations.push(parsed);
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
