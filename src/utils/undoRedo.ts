import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import type { Message } from '../components/main/types';
import {
  createSession,
  getCurrentSession,
  pushUndoState,
  popUndoState,
  pushRedoState,
  popRedoState,
  clearRedoStates,
  getUndoCount,
  getRedoCount,
  cleanupOldSessions,
  type UndoRedoState,
  type FileSnapshot
} from './undoRedoDb';

export type { UndoRedoState, FileSnapshot };

let currentSessionId: string | null = null;
let pendingFileSnapshots: FileSnapshot[] = [];

function getWorkspaceMosaicDir(): string {
  const workspace = process.cwd();
  const mosaicDir = join(workspace, '.mosaic');

  if (!existsSync(mosaicDir)) {
    mkdirSync(mosaicDir, { recursive: true });
  }

  return mosaicDir;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isGitRepository(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore', cwd: process.cwd() });
    return true;
  } catch {
    return false;
  }
}

export function getGitStatus(): { clean: boolean; hasChanges: boolean } {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: process.cwd() });
    const hasChanges = status.trim().length > 0;
    return { clean: !hasChanges, hasChanges };
  } catch {
    return { clean: false, hasChanges: false };
  }
}

export function initializeSession(): void {
  cleanupOldSessions(7);

  const existingSession = getCurrentSession();
  if (existingSession) {
    currentSessionId = existingSession.id;
  } else {
    currentSessionId = createSession();
  }

  pendingFileSnapshots = [];
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function captureFileSnapshot(filePath: string): void {
  const workspace = process.cwd();
  const fullPath = resolve(workspace, filePath);

  let content = '';
  let existed = false;

  try {
    const fs = require('fs');
    content = fs.readFileSync(fullPath, 'utf-8');
    existed = true;
  } catch {
    existed = false;
  }

  const alreadyCaptured = pendingFileSnapshots.some(s => s.path === filePath);
  if (!alreadyCaptured) {
    pendingFileSnapshots.push({
      path: filePath,
      content,
      existed
    });
  }
}

function createGitCommit(message: string): string | null {
  try {
    const workspace = process.cwd();

    execSync('git add -A', { cwd: workspace, stdio: 'ignore' });

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: workspace,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Mosaic',
        GIT_AUTHOR_EMAIL: 'mosaic@local',
        GIT_COMMITTER_NAME: 'Mosaic',
        GIT_COMMITTER_EMAIL: 'mosaic@local'
      }
    });

    const hash = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: workspace }).trim();
    return hash;
  } catch (error) {
    console.error('Failed to create Git commit:', error);
    return null;
  }
}

export function saveState(messages: Message[]): void {
  if (!currentSessionId) {
    return;
  }

  const useGit = isGitRepository();
  let gitCommitHash: string | undefined;

  if (useGit) {
    const gitStatus = getGitStatus();
    if (gitStatus.hasChanges) {
      const hash = createGitCommit(`[Mosaic] Save state - ${new Date().toISOString()}`);
      if (hash) {
        gitCommitHash = hash;
      }
    }
  }

  const state: UndoRedoState = {
    id: generateId(),
    timestamp: Date.now(),
    messages: JSON.parse(JSON.stringify(messages)),
    gitCommitHash,
    fileSnapshots: JSON.parse(JSON.stringify(pendingFileSnapshots)),
    useGit
  };

  pushUndoState(currentSessionId, state);
  clearRedoStates(currentSessionId);
  pendingFileSnapshots = [];
}

function restoreFileSnapshots(snapshots: FileSnapshot[]): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const workspace = process.cwd();

  for (const snapshot of snapshots) {
    try {
      const fullPath = resolve(workspace, snapshot.path);
      if (snapshot.existed) {
        writeFileSync(fullPath, snapshot.content, 'utf-8');
      } else {
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Failed to restore ${snapshot.path}: ${errorMsg}`);
    }
  }

  return {
    success: errors.length === 0,
    errors
  };
}

export function canUndo(): boolean {
  if (!currentSessionId) return false;
  return getUndoCount(currentSessionId) > 0;
}

export function canRedo(): boolean {
  if (!currentSessionId) return false;
  return getRedoCount(currentSessionId) > 0;
}

export function undo(): { state: UndoRedoState; success: boolean; error?: string } | null {
  if (!currentSessionId || !canUndo()) {
    return null;
  }

  const state = popUndoState(currentSessionId);
  if (!state) {
    return null;
  }

  try {
    if (state.useGit && state.gitCommitHash) {
      const workspace = process.cwd();
      execSync(`git reset --hard ${state.gitCommitHash}^`, { cwd: workspace, stdio: 'ignore' });
    } else {
      const restoreResult = restoreFileSnapshots(state.fileSnapshots);
      if (!restoreResult.success) {
        throw new Error(restoreResult.errors.join('\n'));
      }
    }

    pushRedoState(currentSessionId, state);

    return { state, success: true };
  } catch (error) {
    pushUndoState(currentSessionId, state);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { state, success: false, error: errorMsg };
  }
}

export function redo(): { state: UndoRedoState; success: boolean; error?: string } | null {
  if (!currentSessionId || !canRedo()) {
    return null;
  }

  const state = popRedoState(currentSessionId);
  if (!state) {
    return null;
  }

  try {
    if (state.useGit && state.gitCommitHash) {
      const workspace = process.cwd();
      execSync(`git reset --hard ${state.gitCommitHash}`, { cwd: workspace, stdio: 'ignore' });
    } else {
      const restoreResult = restoreFileSnapshots(state.fileSnapshots);
      if (!restoreResult.success) {
        throw new Error(restoreResult.errors.join('\n'));
      }
    }

    pushUndoState(currentSessionId, state);

    return { state, success: true };
  } catch (error) {
    pushRedoState(currentSessionId, state);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { state, success: false, error: errorMsg };
  }
}

export function getUndoStack(): UndoRedoState[] {
  return [];
}

export function getRedoStack(): UndoRedoState[] {
  return [];
}

export function clearSession(): void {
  if (!currentSessionId) return;

  clearRedoStates(currentSessionId);
  currentSessionId = null;
  pendingFileSnapshots = [];
}

export { getAllSessions, setCurrentSession, deleteSession } from './undoRedoDb';
