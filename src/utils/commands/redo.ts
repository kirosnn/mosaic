import type { Command, CommandResult } from './types';
import { redo, canRedo, isGitRepository } from '../undoRedo';
import { notifyUndoRedo } from '../undoRedoBridge';

export const redoCommand: Command = {
  name: 'redo',
  description: 'Redo a previously undone message. Only available after using /undo. Any file changes will also be restored. Internally, this uses Git to manage the file changes if available.',
  usage: '/redo',
  aliases: ['r'],
  execute: async (): Promise<CommandResult> => {
    if (!canRedo()) {
      return {
        success: false,
        content: 'Nothing to redo. Use /undo first, or the redo stack is empty.',
        shouldAddToHistory: false
      };
    }

    const result = redo();
    if (!result) {
      return {
        success: false,
        content: 'Failed to redo. Could not retrieve state.',
        shouldAddToHistory: false
      };
    }

    if (!result.success) {
      return {
        success: false,
        content: `Failed to redo file changes:\n${result.error || 'Unknown error'}`,
        shouldAddToHistory: false
      };
    }

    notifyUndoRedo(result.state, 'redo');

    const methodUsed = result.state.useGit && result.state.gitCommitHash ? 'Git' : 'snapshots';
    const details = result.state.gitCommitHash
      ? `\n- Restored to Git commit: ${result.state.gitCommitHash.slice(0, 7)}`
      : `\n- Restored ${result.state.fileSnapshots.length} file(s)`;

    return {
      success: true,
      content: `Successfully redone action (using ${methodUsed}).${details}\n- Restored ${result.state.messages.length} message(s)`,
      shouldAddToHistory: false
    };
  }
};
