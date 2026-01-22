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
    } else {
      try {
        const currentHash = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
        gitCommitHash = currentHash;
      } catch {
        gitCommitHash = undefined;
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


function getUntrackedFiles(): string[] {
  try {
    const workspace = process.cwd();
    const output = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8', cwd: workspace });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getFileSnapshot(filePath: string): FileSnapshot {
  const workspace = process.cwd();
  const fullPath = resolve(workspace, filePath);
  let content = '';
  let existed = false;

  try {
    if (existsSync(fullPath)) {
      const fs = require('fs');
      content = fs.readFileSync(fullPath, 'utf-8');
      existed = true;
    }
  } catch {
    existed = false;
  }

  return { path: filePath, content, existed };
}

function getGitChanges(targetHash: string): FileChange[] {
  if (!isGitRepository()) {
    return [];
  }

  try {
    const workspace = process.cwd();
    const diffOutput = execSync(`git diff --name-status HEAD ${targetHash}`, {
      encoding: 'utf-8',
      cwd: workspace
    });

    const changes = diffOutput
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const parts = line.split('\t');
        const status = parts[0];
        const pathParts = parts.slice(1);

        if (!status) return null;

        return {
          status: status.charAt(0),
          path: pathParts.join('\t')
        };
      })
      .filter((item): item is FileChange => item !== null);

    const untracked = getUntrackedFiles();
    const untrackedChanges = untracked.map(path => ({
      status: 'D',
      path
    }));

    return [...changes, ...untrackedChanges];
  } catch (error) {
    console.error('Failed to get git changes:', error);
    return [];
  }
}

export interface FileChange {
  path: string;
  status: string;
}

export function undo(): { state: UndoRedoState; success: boolean; error?: string; currentState?: UndoRedoState; gitChanges?: FileChange[] } | null {
  if (!currentSessionId || !canUndo()) {
    return null;
  }

  const workspace = process.cwd();
  const useGit = isGitRepository();

  let currentStateForRedo: UndoRedoState;

  try {
    if (useGit) {
      let currentHash: string | undefined;
      try {
        currentHash = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: workspace }).trim();
      } catch {
        currentHash = undefined;
      }

      const untrackedFiles = getUntrackedFiles();
      const untrackedSnapshots = untrackedFiles.map(f => getFileSnapshot(f));

      currentStateForRedo = {
        id: generateId(),
        timestamp: Date.now(),
        messages: [],
        gitCommitHash: currentHash,
        fileSnapshots: untrackedSnapshots,
        useGit: true
      };
    } else {
      currentStateForRedo = {
        id: generateId(),
        timestamp: Date.now(),
        messages: [],
        gitCommitHash: undefined,
        fileSnapshots: pendingFileSnapshots.length > 0 ? JSON.parse(JSON.stringify(pendingFileSnapshots)) : [],
        useGit: false
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { state: { id: '', timestamp: 0, messages: [], fileSnapshots: [], useGit: false }, success: false, error: errorMsg };
  }

  const state = popUndoState(currentSessionId);
  if (!state) {
    return null;
  }

  let gitChanges: FileChange[] = [];

  try {
    if (state.useGit && state.gitCommitHash) {
      gitChanges = getGitChanges(state.gitCommitHash);

      const filesToClean = getUntrackedFiles();

      execSync(`git reset --hard ${state.gitCommitHash}`, { cwd: workspace, stdio: 'ignore' });
      execSync('git clean -fd', { cwd: workspace, stdio: 'ignore' });
      if (filesToClean.length > 0) {
        const fs = require('fs');
        for (const file of filesToClean) {
          const fullPath = resolve(workspace, file);
          if (existsSync(fullPath)) {
            try {
              const stat = fs.lstatSync(fullPath);
              if (stat.isDirectory()) {
                fs.rmSync(fullPath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(fullPath);
              }
            } catch (cleanupError) {
              console.error(`Failed to force delete ${file}:`, cleanupError);
            }
          }
        }
      }
    } else {
      const restoreResult = restoreFileSnapshots(state.fileSnapshots);
      if (!restoreResult.success) {
        throw new Error(restoreResult.errors.join('\n'));
      }
    }

    pushRedoState(currentSessionId, currentStateForRedo);

    return { state, success: true, currentState: currentStateForRedo, gitChanges };
  } catch (error) {
    pushUndoState(currentSessionId, state);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { state, success: false, error: errorMsg };
  }
}

export function redo(): { state: UndoRedoState; success: boolean; error?: string; gitChanges?: FileChange[] } | null {
  if (!currentSessionId || !canRedo()) {
    return null;
  }

  const state = popRedoState(currentSessionId);
  if (!state) {
    return null;
  }

  let gitChanges: FileChange[] = [];

  try {
    if (state.useGit && state.gitCommitHash) {
      const workspace = process.cwd();
      gitChanges = getGitChanges(state.gitCommitHash);

      execSync(`git reset --hard ${state.gitCommitHash}`, { cwd: workspace, stdio: 'ignore' });
      restoreFileSnapshots(state.fileSnapshots);
    } else {
      const restoreResult = restoreFileSnapshots(state.fileSnapshots);
      if (!restoreResult.success) {
        throw new Error(restoreResult.errors.join('\n'));
      }
    }

    pushUndoState(currentSessionId, state);

    return { state, success: true, gitChanges };
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
