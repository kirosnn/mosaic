import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const execAsync = promisify(execCallback);

export interface GitRemoteInfo {
  name: string;
  fetch?: string;
  push?: string;
}

export interface GitBranchTrackingInfo {
  branch: string;
  upstreamBranch?: string;
  aheadCount?: number;
  behindCount?: number;
  isCurrent?: boolean;
}

export interface GitWorkspaceState {
  isGitRepository: boolean;
  currentBranch?: string;
  upstreamBranch?: string;
  aheadCount: number;
  behindCount: number;
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
  renamedCount: number;
  untrackedCount: number;
  keyChangedPaths: string[];
  remotes: GitRemoteInfo[];
  branchTrackingInfo: GitBranchTrackingInfo[];
}

export interface GitCommandCapture {
  command: string;
  output: string;
}

const READ_ONLY_GIT_COMMAND_PATTERNS = [
  /^git\s+status(?:\s|$)/i,
  /^git\s+diff(?:\s|$)/i,
  /^git\s+rev-list\s+.*--left-right\s+.*--count(?:\s|$)/i,
  /^git\s+branch\s+(?:--show-current\b|-v\b|-vv\b|-a\b|-r\b|--list\b)(?:\s|$)/i,
  /^git\s+log(?:\s|$)/i,
  /^git\s+remote\s+(?:-v\b|--verbose\b|show\b)(?:\s|$)/i,
  /^git\s+ls-files(?:\s|$)/i,
  /^git\s+(?:show|describe|rev-parse|shortlog|blame|ls-tree|for-each-ref|cat-file|check-ignore)(?:\s|$)/i,
  /^git\s+stash\s+list(?:\s|$)/i,
  /^git\s+tag\s*(?:-l\b|--list\b|$)/i,
];

function normalizeCommandOutput(text: string): string {
  if (!text) return '';
  let s = text.replace(/\r\n/g, '\n');
  if (s.includes('\r')) {
    const parts = s.split('\n');
    s = parts.map(p => (p.includes('\r') ? (p.split('\r').pop() || '') : p)).join('\n');
  }
  s = s.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return s;
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, Math.floor(maxChars / 2) - 3))}\n...\n${text.slice(-Math.max(0, Math.floor(maxChars / 2) - 3))}`;
}

function createGitWorkspaceState(): GitWorkspaceState {
  return {
    isGitRepository: false,
    aheadCount: 0,
    behindCount: 0,
    modifiedCount: 0,
    addedCount: 0,
    deletedCount: 0,
    renamedCount: 0,
    untrackedCount: 0,
    keyChangedPaths: [],
    remotes: [],
    branchTrackingInfo: [],
  };
}

function pushUniquePath(target: string[], value: string, limit = 8): void {
  const normalized = value.trim();
  if (!normalized || target.includes(normalized) || target.length >= limit) {
    return;
  }
  target.push(normalized);
}

function parseTrackingCounts(source: string): { aheadCount: number; behindCount: number } {
  const aheadMatch = source.match(/ahead\s+(\d+)/i);
  const behindMatch = source.match(/behind\s+(\d+)/i);
  return {
    aheadCount: aheadMatch ? parseInt(aheadMatch[1] || '0', 10) : 0,
    behindCount: behindMatch ? parseInt(behindMatch[1] || '0', 10) : 0,
  };
}

function mergeTrackingCounts(state: GitWorkspaceState, counts: { aheadCount: number; behindCount: number }): void {
  if (counts.aheadCount > 0) {
    state.aheadCount = counts.aheadCount;
  }
  if (counts.behindCount > 0) {
    state.behindCount = counts.behindCount;
  }
}

function parseGitStatusOutput(output: string, state: GitWorkspaceState): void {
  const lines = output.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const branchHeader = line.slice(3);
      const trackedMatch = branchHeader.match(/^([^.[\s]+)(?:\.\.\.([^\s[]+))?(?: \[(.+)\])?$/);
      if (trackedMatch) {
        state.currentBranch = trackedMatch[1];
        if (trackedMatch[2]) {
          state.upstreamBranch = trackedMatch[2];
        }
        if (trackedMatch[3]) {
          mergeTrackingCounts(state, parseTrackingCounts(trackedMatch[3]));
        }
      } else {
        const unbornMatch = branchHeader.match(/(?:No commits yet on|Initial commit on)\s+(.+)$/i);
        if (unbornMatch) {
          state.currentBranch = unbornMatch[1]?.trim();
        }
      }
      continue;
    }

    if (line.startsWith('?? ')) {
      state.untrackedCount++;
      pushUniquePath(state.keyChangedPaths, line.slice(3));
      continue;
    }

    if (line.length < 3) {
      continue;
    }

    const status = line.slice(0, 2);
    const pathPart = line.slice(3).trim();
    const renamedPath = pathPart.includes(' -> ') ? pathPart.split(' -> ').pop() || pathPart : pathPart;
    pushUniquePath(state.keyChangedPaths, renamedPath);

    if (status.includes('R')) state.renamedCount++;
    if (status.includes('A')) state.addedCount++;
    if (status.includes('D')) state.deletedCount++;
    if (status.includes('M') || status.includes('T')) state.modifiedCount++;
  }
}

function parseGitRemoteOutput(output: string, state: GitWorkspaceState): void {
  const remotes = new Map<string, GitRemoteInfo>();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/i);
    if (!match) {
      continue;
    }
    const name = match[1];
    const url = match[2];
    const kind = match[3];
    if (!name || !url || !kind) {
      continue;
    }
    const entry: GitRemoteInfo = remotes.get(name) ?? { name };
    if (kind.toLowerCase() === 'fetch') {
      entry.fetch = url;
    } else {
      entry.push = url;
    }
    remotes.set(name, entry);
  }
  state.remotes = [...remotes.values()];
}

function parseGitBranchVerboseOutput(output: string, state: GitWorkspaceState): void {
  const items: GitBranchTrackingInfo[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      continue;
    }
    if (!trimmed.includes(' ')) {
      const branchName = trimmed.trim();
      if (branchName) {
        state.currentBranch = branchName;
      }
      continue;
    }
    const match = trimmed.match(/^([* ])\s+(\S+)\s+\S+(?:\s+\[(.+?)\])?/);
    if (!match) {
      continue;
    }
    const marker = match[1];
    const branch = match[2];
    const tracking = match[3];
    if (!marker || !branch) {
      continue;
    }
    const item: GitBranchTrackingInfo = {
      branch,
      isCurrent: marker === '*',
    };
    if (tracking) {
      const [upstream, detail = ''] = tracking.split(':', 2);
      item.upstreamBranch = upstream?.trim();
      const counts = parseTrackingCounts(detail);
      if (counts.aheadCount > 0) item.aheadCount = counts.aheadCount;
      if (counts.behindCount > 0) item.behindCount = counts.behindCount;
      if (item.isCurrent) {
        if (!state.upstreamBranch && item.upstreamBranch) {
          state.upstreamBranch = item.upstreamBranch;
        }
        mergeTrackingCounts(state, counts);
      }
    }
    if (item.isCurrent && !state.currentBranch) {
      state.currentBranch = branch;
    }
    items.push(item);
  }
  state.branchTrackingInfo = items;
}

function parseGitRevListCountOutput(output: string, state: GitWorkspaceState): void {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return;
  }
  state.behindCount = parseInt(match[1] || '0', 10);
  state.aheadCount = parseInt(match[2] || '0', 10);
}

function applyGitWorkspaceCapture(entry: GitCommandCapture, state: GitWorkspaceState): void {
  const normalizedCommand = entry.command.trim().replace(/\s+/g, ' ');
  if (/^git\s+status(?:\s|$)/i.test(normalizedCommand)) {
    parseGitStatusOutput(entry.output, state);
    return;
  }
  if (/^git\s+remote\s+(?:-v\b|--verbose\b|show\b)/i.test(normalizedCommand)) {
    parseGitRemoteOutput(entry.output, state);
    return;
  }
  if (/^git\s+branch\s+(?:-v\b|-vv\b|--show-current\b)/i.test(normalizedCommand)) {
    parseGitBranchVerboseOutput(entry.output, state);
    return;
  }
  if (/^git\s+rev-list\s+.*--left-right\s+.*--count(?:\s|$)/i.test(normalizedCommand)) {
    parseGitRevListCountOutput(entry.output, state);
  }
}

async function runGitCommand(command: string, cwd: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: timeoutMs,
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      TERM: process.env.TERM || 'dumb',
      NO_COLOR: process.env.NO_COLOR || '1',
      GIT_PAGER: process.env.GIT_PAGER || 'cat',
      PAGER: process.env.PAGER || 'cat',
    },
  });
  return normalizeCommandOutput((stdout || '') + (stderr || ''));
}

export function isReadOnlyGitInspectionCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return false;
  }
  return READ_ONLY_GIT_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function collectGitWorkspaceStateFromCaptures(entries: GitCommandCapture[]): GitWorkspaceState {
  const state = createGitWorkspaceState();
  state.isGitRepository = entries.length > 0;
  for (const entry of entries) {
    applyGitWorkspaceCapture(entry, state);
  }
  return state;
}

export function formatStructuredGitInspection(entries: GitCommandCapture[]): string {
  const payload = {
    summary: collectGitWorkspaceStateFromCaptures(entries),
    raw: entries.map((entry) => ({
      command: entry.command,
      output: truncateMiddle(entry.output, 500),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export function formatGitWorkspaceSummary(state: GitWorkspaceState, maxChars = 700): string {
  if (!state.isGitRepository) {
    return 'Not a git repository.';
  }

  const lines: string[] = [];
  lines.push(`Current branch: ${state.currentBranch || 'unknown'}`);
  if (state.upstreamBranch) {
    lines.push(`Upstream: ${state.upstreamBranch}`);
  }
  lines.push(`Ahead/behind: ${state.aheadCount}/${state.behindCount}`);
  lines.push(`Changes: modified=${state.modifiedCount}, added=${state.addedCount}, deleted=${state.deletedCount}, renamed=${state.renamedCount}, untracked=${state.untrackedCount}`);
  if (state.keyChangedPaths.length > 0) {
    lines.push(`Key changed paths: ${state.keyChangedPaths.join(', ')}`);
  }
  if (state.remotes.length > 0) {
    lines.push(`Remotes: ${state.remotes.map((remote) => remote.name).join(', ')}`);
  }

  const text = lines.join('\n');
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export async function collectGitWorkspaceState(workspace: string = process.cwd(), timeoutMs = 5000): Promise<GitWorkspaceState> {
  const state = createGitWorkspaceState();

  try {
    const inside = await runGitCommand('git rev-parse --is-inside-work-tree', workspace, timeoutMs);
    if (!/^true$/im.test(inside.trim())) {
      return state;
    }
  } catch {
    return state;
  }

  state.isGitRepository = true;

  const statusOutputPromise = runGitCommand('git status --short --branch', workspace, timeoutMs);
  const remoteOutputPromise = runGitCommand('git remote -v', workspace, timeoutMs).catch(() => '');
  const branchOutputPromise = runGitCommand('git branch -vv --no-color', workspace, timeoutMs).catch(() => '');

  const [statusOutput, remoteOutput, branchOutput] = await Promise.all([
    statusOutputPromise,
    remoteOutputPromise,
    branchOutputPromise,
  ]);

  applyGitWorkspaceCapture({ command: 'git status --short --branch', output: statusOutput }, state);
  applyGitWorkspaceCapture({ command: 'git remote -v', output: remoteOutput }, state);
  applyGitWorkspaceCapture({ command: 'git branch -vv --no-color', output: branchOutput }, state);

  if (state.upstreamBranch) {
    try {
      const revListOutput = await runGitCommand('git rev-list --left-right --count HEAD...@{upstream}', workspace, timeoutMs);
      applyGitWorkspaceCapture({ command: 'git rev-list --left-right --count HEAD...@{upstream}', output: revListOutput }, state);
    } catch {
    }
  }

  return state;
}
