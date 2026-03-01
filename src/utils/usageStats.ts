import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';

type UsageStatsResult = {
  totalInput: number;
  totalOutput: number;
  totalMessages: number;
  entries: Array<{
    model: string;
    provider: string;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    messages: number;
  }>;
};

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function parseDay(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function resolveHistoryDir(): string {
  const envHome = (process.env.MOSAIC_HOME || '').trim();
  const base = envHome ? resolve(envHome) : join(homedir(), '.mosaic');
  return join(base, 'history');
}

function buildRangeFromArgs(args: string[]): { startMs: number | null; endMs: number | null } {
  const sinceIndex = args.indexOf('--since');
  const untilIndex = args.indexOf('--until');

  const since = sinceIndex >= 0 ? args[sinceIndex + 1] : undefined;
  const until = untilIndex >= 0 ? args[untilIndex + 1] : undefined;

  const startMs = parseDay(since);
  const untilStartMs = parseDay(until);
  const endMs = untilStartMs === null ? null : untilStartMs + 24 * 60 * 60 * 1000 - 1;

  return { startMs, endMs };
}

function inRange(timestamp: number, range: { startMs: number | null; endMs: number | null }): boolean {
  if (range.startMs !== null && timestamp < range.startMs) return false;
  if (range.endMs !== null && timestamp > range.endMs) return false;
  return true;
}

export async function runUsageStatsCommand(args: string[]): Promise<{ success: boolean; content: string }>{
  const command = (args[0] || '').trim();
  const raw = args.includes('--raw');
  if (command !== 'models') {
    return { success: false, content: JSON.stringify({ error: `Unknown usage command: ${command || 'n/a'}` }) };
  }

  const range = buildRangeFromArgs(args);
  const historyDir = resolveHistoryDir();

  let files: string[] = [];
  try {
    files = (await readdir(historyDir)).filter((f) => f.endsWith('.json') && f !== 'inputs.json');
  } catch {
    const empty: UsageStatsResult = { totalInput: 0, totalOutput: 0, totalMessages: 0, entries: [] };
    return { success: true, content: JSON.stringify(empty) };
  }

  const aggregate = new Map<string, UsageStatsResult['entries'][number]>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalMessages = 0;

  for (const file of files) {
    const filePath = join(historyDir, file);
    let parsed: any;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf-8'));
    } catch {
      continue;
    }

    const timestamp = typeof parsed?.timestamp === 'number' ? parsed.timestamp : NaN;
    if (!Number.isFinite(timestamp)) continue;
    if (!inRange(timestamp, range)) continue;

    const prompt = toNonNegativeInt(parsed?.totalTokens?.prompt);
    const completion = toNonNegativeInt(parsed?.totalTokens?.completion);
    const total = Math.max(toNonNegativeInt(parsed?.totalTokens?.total), prompt + completion);

    const model = typeof parsed?.model === 'string' && parsed.model.trim() ? parsed.model.trim() : 'unknown';
    const provider = typeof parsed?.provider === 'string' && parsed.provider.trim() ? parsed.provider.trim() : 'unknown';

    totalInput += prompt;
    totalOutput += completion;
    totalMessages += 1;

    const key = `${provider}::${model}`;
    const entry = aggregate.get(key) ?? {
      model,
      provider,
      totalInput: 0,
      totalOutput: 0,
      totalTokens: 0,
      messages: 0,
    };
    entry.totalInput += prompt;
    entry.totalOutput += completion;
    entry.totalTokens += total;
    entry.messages += 1;
    aggregate.set(key, entry);
  }

  const entries = Array.from(aggregate.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  const result: UsageStatsResult = { totalInput, totalOutput, totalMessages, entries };

  if (raw) {
    return { success: true, content: JSON.stringify(result) };
  }

  return {
    success: true,
    content: JSON.stringify(result),
  };
}
