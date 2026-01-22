import type { FileChanges } from './fileChangeTracker';

type FileChangesCallback = (changes: FileChanges) => void;

let callback: FileChangesCallback | null = null;

export function subscribeFileChanges(cb: FileChangesCallback): () => void {
  callback = cb;
  return () => {
    callback = null;
  };
}

export function notifyFileChanges(changes: FileChanges): void {
  if (callback) {
    callback(changes);
  }
}
