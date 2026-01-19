import type { Command, CommandResult } from './types';
import { getAllSessions, setCurrentSession, deleteSession } from '../undoRedoDb';

export const sessionsCommand: Command = {
  name: 'sessions',
  description: 'Manage undo/redo sessions. List all sessions or switch to a specific session.',
  usage: '/sessions [list|switch <session-id>|delete <session-id>]',
  aliases: ['s'],
  execute: async (args?: string): Promise<CommandResult> => {
    const parts = args?.trim().split(/\s+/) || [];
    const action = parts[0] || 'list';

    if (action === 'list') {
      const sessions = getAllSessions();

      if (sessions.length === 0) {
        return {
          success: true,
          content: 'No sessions found.',
          shouldAddToHistory: false
        };
      }

      const lines = ['Available sessions:\n'];
      for (const session of sessions) {
        const current = session.isCurrent ? ' (current)' : '';
        const date = new Date(session.lastAccessedAt).toLocaleString();
        lines.push(`- ${session.id}${current}`);
        lines.push(`  Last accessed: ${date}`);
      }

      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false
      };
    }

    if (action === 'switch') {
      const sessionId = parts[1];
      if (!sessionId) {
        return {
          success: false,
          content: 'Please provide a session ID to switch to.\nUsage: /sessions switch <session-id>',
          shouldAddToHistory: false
        };
      }

      const sessions = getAllSessions();
      const targetSession = sessions.find(s => s.id === sessionId);

      if (!targetSession) {
        return {
          success: false,
          content: `Session not found: ${sessionId}`,
          shouldAddToHistory: false
        };
      }

      try {
        setCurrentSession(sessionId);
        return {
          success: true,
          content: `Switched to session: ${sessionId}`,
          shouldAddToHistory: false
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          content: `Failed to switch session: ${errorMsg}`,
          shouldAddToHistory: false
        };
      }
    }

    if (action === 'delete') {
      const sessionId = parts[1];
      if (!sessionId) {
        return {
          success: false,
          content: 'Please provide a session ID to delete.\nUsage: /sessions delete <session-id>',
          shouldAddToHistory: false
        };
      }

      const sessions = getAllSessions();
      const targetSession = sessions.find(s => s.id === sessionId);

      if (!targetSession) {
        return {
          success: false,
          content: `Session not found: ${sessionId}`,
          shouldAddToHistory: false
        };
      }

      if (targetSession.isCurrent) {
        return {
          success: false,
          content: 'Cannot delete the current session. Switch to another session first.',
          shouldAddToHistory: false
        };
      }

      try {
        deleteSession(sessionId);
        return {
          success: true,
          content: `Deleted session: ${sessionId}`,
          shouldAddToHistory: false
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          content: `Failed to delete session: ${errorMsg}`,
          shouldAddToHistory: false
        };
      }
    }

    return {
      success: false,
      content: `Unknown action: ${action}\nUsage: /sessions [list|switch <session-id>|delete <session-id>]`,
      shouldAddToHistory: false
    };
  }
};
