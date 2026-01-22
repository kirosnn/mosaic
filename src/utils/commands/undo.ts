import type { Command, CommandResult } from './types';
import { undo, canUndo, isGitRepository } from '../undoRedo';
import { notifyUndoRedo } from '../undoRedoBridge';

export const undoCommand: Command = {
  name: 'undo',
  description: 'Undo last message in the conversation. Removes the most recent user message, all subsequent responses, and any file changes. Any file changes made will also be reverted. Internally, this uses Git to manage the file changes if available (local repository works too).',
  usage: '/undo',
  aliases: ['u'],
  execute: async (): Promise<CommandResult> => {
    if (!canUndo()) {
      return {
        success: false,
        content: 'Nothing to undo. The undo stack is empty.',
        shouldAddToHistory: false
      };
    }

    const result = undo();
    if (!result) {
      return {
        success: false,
        content: 'Failed to undo. Could not retrieve previous state.',
        shouldAddToHistory: false
      };
    }

    if (!result.success) {
      return {
        success: false,
        content: `Failed to undo file changes:\n${result.error || 'Unknown error'}`,
        shouldAddToHistory: false
      };
    }

    notifyUndoRedo(result.state, 'undo');

    const messageCountText = result.state.messages.length === 0 ? 'conversation cleared' : `${result.state.messages.length} message(s) restored`;

    let details = '';

    if (result.gitChanges && result.gitChanges.length > 0) {
      const fileDetails = result.gitChanges.map(f => {
        switch (f.status) {
          case 'M': return `  • ${f.path} (reverted changes)`;
          case 'A': return `  • ${f.path} (restored - was deleted)`;
          case 'D': return `  • ${f.path} (deleted - was created)`;
          case 'R': return `  • ${f.path} (renamed back)`;
          default: return `  • ${f.path} (status: ${f.status})`;
        }
      }).join('\n');
      details = `\n- Files affected (${result.gitChanges.length}):\n${fileDetails}`;
    } else if (result.state.fileSnapshots.length > 0) {
      const filesAffected = result.state.fileSnapshots.map(f => f.path).join(', ');
      const fileDetails = result.state.fileSnapshots.map(f => {
        if (!f.existed) {
          return `  • ${f.path} (deleted - was created)`;
        } else if (f.content === '') {
          return `  • ${f.path} (restored - was deleted)`;
        } else {
          return `  • ${f.path} (restored)`;
        }
      }).join('\n');
      details = `\n- Files affected (${result.state.fileSnapshots.length}):\n${fileDetails}`;
    } else if (result.state.gitCommitHash) {
      details = `\n- Files reverted via Git (commit: ${result.state.gitCommitHash.slice(0, 7)})`;
    }

    return {
      success: true,
      content: `Undone last user message and all responses.${details}\n- ${messageCountText}`,
      shouldAddToHistory: false
    };
  }
};
