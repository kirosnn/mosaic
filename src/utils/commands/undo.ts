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

    const methodUsed = result.state.useGit && result.state.gitCommitHash ? 'Git' : 'snapshots';
    const details = result.state.gitCommitHash
      ? `\n- Reverted to Git commit: ${result.state.gitCommitHash.slice(0, 7)}`
      : `\n- Restored ${result.state.fileSnapshots.length} file(s)`;

    return {
      success: true,
      content: `Successfully undone last action (using ${methodUsed}).${details}\n- Restored ${result.state.messages.length} message(s)`,
      shouldAddToHistory: false
    };
  }
};
