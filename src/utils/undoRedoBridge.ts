import type { Message } from '../components/main/types';
import type { UndoRedoState } from './undoRedo';

type UndoRedoCallback = (state: UndoRedoState | null, action: 'undo' | 'redo') => void;

let callback: UndoRedoCallback | null = null;

export function subscribeUndoRedo(cb: UndoRedoCallback): () => void {
  callback = cb;
  return () => {
    callback = null;
  };
}

export function notifyUndoRedo(state: UndoRedoState | null, action: 'undo' | 'redo'): void {
  if (callback) {
    callback(state, action);
  }
}

export interface CaptureSnapshotRequest {
  messages: Message[];
  resolve: () => void;
}

type CaptureSnapshotCallback = (request: CaptureSnapshotRequest) => void;

let captureCallback: CaptureSnapshotCallback | null = null;

export function subscribeCaptureSnapshot(cb: CaptureSnapshotCallback): () => void {
  captureCallback = cb;
  return () => {
    captureCallback = null;
  };
}

export function requestCaptureSnapshot(messages: Message[]): Promise<void> {
  return new Promise((resolve) => {
    if (captureCallback) {
      captureCallback({ messages, resolve });
    } else {
      resolve();
    }
  });
}