import Database from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Message } from '../components/main/types';

export interface FileSnapshot {
  path: string;
  content: string;
  existed: boolean;
}

export interface UndoRedoState {
  id: string;
  timestamp: number;
  messages: Message[];
  gitCommitHash?: string;
  fileSnapshots: FileSnapshot[];
  useGit: boolean;
}

export interface Session {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
  isCurrent: boolean;
}

let db: Database | null = null;

function getWorkspaceMosaicDir(): string {
  const workspace = process.cwd();
  const mosaicDir = join(workspace, '.mosaic');

  if (!existsSync(mosaicDir)) {
    mkdirSync(mosaicDir, { recursive: true });
  }

  return mosaicDir;
}

function getDatabasePath(): string {
  const mosaicDir = getWorkspaceMosaicDir();
  return join(mosaicDir, 'undo-redo.db');
}

function getDatabase(): Database {
  if (!db) {
    const dbPath = getDatabasePath();
    db = new Database(dbPath);
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_current ON sessions(is_current);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed_at);

    CREATE TABLE IF NOT EXISTS undo_states (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      messages TEXT NOT NULL,
      git_commit_hash TEXT,
      file_snapshots TEXT NOT NULL,
      use_git INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_undo_states_session ON undo_states(session_id, position);

    CREATE TABLE IF NOT EXISTS redo_states (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      messages TEXT NOT NULL,
      git_commit_hash TEXT,
      file_snapshots TEXT NOT NULL,
      use_git INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_redo_states_session ON redo_states(session_id, position);
  `);

  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec('PRAGMA cache_size = -64000;');
  database.exec('PRAGMA temp_store = MEMORY;');
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createSession(): string {
  const database = getDatabase();
  const sessionId = generateId();
  const now = Date.now();

  database.exec('UPDATE sessions SET is_current = 0 WHERE is_current = 1');

  const stmt = database.prepare(
    'INSERT INTO sessions (id, created_at, last_accessed_at, is_current) VALUES (?, ?, ?, 1)'
  );
  stmt.run(sessionId, now, now);

  return sessionId;
}

export function getCurrentSession(): Session | null {
  const database = getDatabase();
  const stmt = database.prepare<Session, []>(
    'SELECT id, created_at as createdAt, last_accessed_at as lastAccessedAt, is_current as isCurrent FROM sessions WHERE is_current = 1'
  );
  const row = stmt.get();
  return row ? { ...row, isCurrent: Boolean(row.isCurrent) } : null;
}

export function setCurrentSession(sessionId: string): void {
  const database = getDatabase();
  const now = Date.now();

  database.exec('BEGIN TRANSACTION');
  try {
    database.exec('UPDATE sessions SET is_current = 0 WHERE is_current = 1');

    const stmt = database.prepare(
      'UPDATE sessions SET is_current = 1, last_accessed_at = ? WHERE id = ?'
    );
    stmt.run(now, sessionId);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function getAllSessions(): Session[] {
  const database = getDatabase();
  const stmt = database.prepare<Session, []>(
    'SELECT id, created_at as createdAt, last_accessed_at as lastAccessedAt, is_current as isCurrent FROM sessions ORDER BY last_accessed_at DESC'
  );
  const rows = stmt.all();
  return rows.map(row => ({ ...row, isCurrent: Boolean(row.isCurrent) }));
}

export function deleteSession(sessionId: string): void {
  const database = getDatabase();
  const stmt = database.prepare('DELETE FROM sessions WHERE id = ?');
  stmt.run(sessionId);
}

export function cleanupOldSessions(daysToKeep: number = 7): number {
  const database = getDatabase();
  const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

  const stmt = database.prepare(
    'DELETE FROM sessions WHERE last_accessed_at < ? AND is_current = 0'
  );
  const result = stmt.run(cutoffTime);

  return result.changes;
}

export function pushUndoState(sessionId: string, state: UndoRedoState): void {
  const database = getDatabase();

  const getMaxPos = database.prepare<{ maxPos: number | null }, [string]>(
    'SELECT MAX(position) as maxPos FROM undo_states WHERE session_id = ?'
  );
  const maxPosResult = getMaxPos.get(sessionId);
  const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

  const stmt = database.prepare(
    `INSERT INTO undo_states (id, session_id, position, timestamp, messages, git_commit_hash, file_snapshots, use_git)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  stmt.run(
    state.id,
    sessionId,
    nextPosition,
    state.timestamp,
    JSON.stringify(state.messages),
    state.gitCommitHash || null,
    JSON.stringify(state.fileSnapshots),
    state.useGit ? 1 : 0
  );
}

export function popUndoState(sessionId: string): UndoRedoState | null {
  const database = getDatabase();

  database.exec('BEGIN TRANSACTION');
  try {
    const getStmt = database.prepare<any, [string]>(
      `SELECT id, timestamp, messages, git_commit_hash, file_snapshots, use_git
       FROM undo_states
       WHERE session_id = ?
       ORDER BY position DESC
       LIMIT 1`
    );
    const row = getStmt.get(sessionId);

    if (!row) {
      database.exec('ROLLBACK');
      return null;
    }

    const deleteStmt = database.prepare(
      'DELETE FROM undo_states WHERE id = ? AND session_id = ?'
    );
    deleteStmt.run(row.id, sessionId);

    database.exec('COMMIT');

    return {
      id: row.id,
      timestamp: row.timestamp,
      messages: JSON.parse(row.messages),
      gitCommitHash: row.git_commit_hash || undefined,
      fileSnapshots: JSON.parse(row.file_snapshots),
      useGit: Boolean(row.use_git)
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function pushRedoState(sessionId: string, state: UndoRedoState): void {
  const database = getDatabase();

  const getMaxPos = database.prepare<{ maxPos: number | null }, [string]>(
    'SELECT MAX(position) as maxPos FROM redo_states WHERE session_id = ?'
  );
  const maxPosResult = getMaxPos.get(sessionId);
  const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

  const stmt = database.prepare(
    `INSERT INTO redo_states (id, session_id, position, timestamp, messages, git_commit_hash, file_snapshots, use_git)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  stmt.run(
    state.id,
    sessionId,
    nextPosition,
    state.timestamp,
    JSON.stringify(state.messages),
    state.gitCommitHash || null,
    JSON.stringify(state.fileSnapshots),
    state.useGit ? 1 : 0
  );
}

export function popRedoState(sessionId: string): UndoRedoState | null {
  const database = getDatabase();

  database.exec('BEGIN TRANSACTION');
  try {
    const getStmt = database.prepare<any, [string]>(
      `SELECT id, timestamp, messages, git_commit_hash, file_snapshots, use_git
       FROM redo_states
       WHERE session_id = ?
       ORDER BY position DESC
       LIMIT 1`
    );
    const row = getStmt.get(sessionId);

    if (!row) {
      database.exec('ROLLBACK');
      return null;
    }

    const deleteStmt = database.prepare(
      'DELETE FROM redo_states WHERE id = ? AND session_id = ?'
    );
    deleteStmt.run(row.id, sessionId);

    database.exec('COMMIT');

    return {
      id: row.id,
      timestamp: row.timestamp,
      messages: JSON.parse(row.messages),
      gitCommitHash: row.git_commit_hash || undefined,
      fileSnapshots: JSON.parse(row.file_snapshots),
      useGit: Boolean(row.use_git)
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function clearRedoStates(sessionId: string): void {
  const database = getDatabase();
  const stmt = database.prepare('DELETE FROM redo_states WHERE session_id = ?');
  stmt.run(sessionId);
}

export function getUndoCount(sessionId: string): number {
  const database = getDatabase();
  const stmt = database.prepare<{ count: number }, [string]>(
    'SELECT COUNT(*) as count FROM undo_states WHERE session_id = ?'
  );
  const result = stmt.get(sessionId);
  return result?.count ?? 0;
}

export function getRedoCount(sessionId: string): number {
  const database = getDatabase();
  const stmt = database.prepare<{ count: number }, [string]>(
    'SELECT COUNT(*) as count FROM redo_states WHERE session_id = ?'
  );
  const result = stmt.get(sessionId);
  return result?.count ?? 0;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
