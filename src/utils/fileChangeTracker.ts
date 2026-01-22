import { notifyFileChanges } from './fileChangesBridge';

export interface FileChanges {
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
}

interface FileState {
  path: string;
  lineCount: number;
  existed: boolean;
}

let currentChanges: FileChanges = {
  linesAdded: 0,
  linesRemoved: 0,
  filesModified: 0
};

let trackedFiles: Map<string, FileState> = new Map();

export function getFileChanges(): FileChanges {
  return { ...currentChanges };
}

export function resetFileChanges(): void {
  currentChanges = {
    linesAdded: 0,
    linesRemoved: 0,
    filesModified: 0
  };
  trackedFiles.clear();
  notifyFileChanges(currentChanges);
}

export function updateFileChangesFromGit(): void {
  notifyFileChanges(currentChanges);
}

export function trackFileChange(filePath: string, oldContent: string, newContent: string): void {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const oldExisted = oldContent.length > 0;
  const newExists = newContent.length > 0;

  const tracked = trackedFiles.get(filePath);

  if (tracked) {
    currentChanges.linesAdded -= Math.max(0, tracked.lineCount);
    currentChanges.linesRemoved -= Math.max(0, tracked.lineCount);
  }

  let added = 0;
  let removed = 0;

  if (!oldExisted && newExists) {
    added = newLines.length;
  } else if (oldExisted && !newExists) {
    removed = oldLines.length;
  } else {
    const maxLength = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLength; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined && newLine !== undefined) {
        added++;
      } else if (oldLine !== undefined && newLine === undefined) {
        removed++;
      } else if (oldLine !== newLine) {
        added++;
        removed++;
      }
    }
  }

  trackedFiles.set(filePath, {
    path: filePath,
    lineCount: Math.max(added, removed),
    existed: newExists
  });

  currentChanges.linesAdded += added;
  currentChanges.linesRemoved += removed;
  currentChanges.filesModified = trackedFiles.size;

  notifyFileChanges(currentChanges);
}

export function trackFileCreated(filePath: string, content: string): void {
  trackFileChange(filePath, '', content);
}

export function trackFileDeleted(filePath: string, oldContent: string): void {
  trackFileChange(filePath, oldContent, '');
}
