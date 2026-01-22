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

    const messageCountText = result.state.messages.length === 0 ? 'conversation restored' : `${result.state.messages.length} message(s) restored`;

    let details = '';

    if (result.gitChanges && result.gitChanges.length > 0) {
      const fileDetails = result.gitChanges.map(f => {
        switch (f.status) {
          case 'M': return `  • ${f.path} (changes reapplied)`;
          case 'A': return `  • ${f.path} (created/restored)`;
          case 'D': return `  • ${f.path} (deleted)`;
          case 'R': return `  • ${f.path} (renamed)`;
          default: return `  • ${f.path} (status: ${f.status})`;
        }
      }).join('\n');
      details = `\n- Files affected (${result.gitChanges.length}):\n${fileDetails}`;
    } else if (result.state.fileSnapshots.length > 0) {
      const fileDetails = result.state.fileSnapshots.map(f => {
        if (!f.existed) {
          return `  • ${f.path} (recreated)`;
        } else if (f.content === '') {
          return `  • ${f.path} (deleted)`;
        } else {
          return `  • ${f.path} (restored)`;
        }
      }).join('\n');
      details = `\n- Files affected (${result.state.fileSnapshots.length}):\n${fileDetails}`;
    } else if (result.state.gitCommitHash) {
      details = `\n- Files restored via Git (commit: ${result.state.gitCommitHash.slice(0, 7)})`;
    }

    return {
      success: true,
      content: `Redone: conversation and file changes restored.${details}\n- ${messageCountText}`,
      shouldAddToHistory: false
    };
  }
};
