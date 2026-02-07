import { generateDiff, formatDiffForDisplay } from './diff';

export interface PendingChange {
    id: string;
    type: 'write' | 'edit' | 'delete';
    path: string;
    originalContent: string;
    newContent: string;
    timestamp: number;
    preview: {
        title: string;
        content: string;
    };
}

type PendingChangesListener = (changes: PendingChange[]) => void;
type ReviewModeListener = (isReviewing: boolean) => void;

let pendingChanges: PendingChange[] = [];
let listeners = new Set<PendingChangesListener>();
let reviewModeListeners = new Set<ReviewModeListener>();
let isReviewMode = false;
let currentReviewIndex = 0;
let reviewResolve: ((approved: boolean[]) => void) | null = null;
let reviewResults: boolean[] = [];

function notify(): void {
    for (const listener of listeners) {
        listener([...pendingChanges]);
    }
}

function notifyReviewMode(): void {
    for (const listener of reviewModeListeners) {
        listener(isReviewMode);
    }
}

function createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildPreview(path: string, originalContent: string, newContent: string): { title: string; content: string } {
    const isCreate = originalContent === '' && newContent !== '';
    const isDelete = originalContent !== '' && newContent === '';
    const diff = generateDiff(originalContent, newContent);
    const lines = diff.hasChanges ? formatDiffForDisplay(diff, 0) : ['No changes'];
    return {
        title: `${isCreate ? 'Create' : isDelete ? 'Delete' : 'Edit'} (${path})`,
        content: lines.join('\n'),
    };
}

function mergePendingChangesByPath(changes: PendingChange[]): PendingChange[] {
    if (changes.length <= 1) return changes;

    const map = new Map<string, PendingChange[]>();
    const order: string[] = [];

    for (const change of changes) {
        const key = change.path;
        if (!map.has(key)) {
            map.set(key, []);
            order.push(key);
        }
        map.get(key)!.push(change);
    }

    const merged: PendingChange[] = [];

    for (const path of order) {
        const list = map.get(path) ?? [];
        if (list.length === 0) continue;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        const originalContent = first.originalContent ?? '';
        const newContent = last.newContent ?? '';
        const preview = buildPreview(path, originalContent, newContent);

        merged.push({
            id: createId(),
            type: last.type,
            path,
            originalContent,
            newContent,
            timestamp: last.timestamp,
            preview,
        });
    }

    return merged;
}

export function subscribePendingChanges(listener: PendingChangesListener): () => void {
    listeners.add(listener);
    listener([...pendingChanges]);
    return () => {
        listeners.delete(listener);
    };
}

export function subscribeReviewMode(listener: ReviewModeListener): () => void {
    reviewModeListeners.add(listener);
    listener(isReviewMode);
    return () => {
        reviewModeListeners.delete(listener);
    };
}

export function addPendingChange(
    type: 'write' | 'edit' | 'delete',
    path: string,
    originalContent: string,
    newContent: string,
    preview: { title: string; content: string }
): string {
    const id = createId();
    pendingChanges.push({
        id,
        type,
        path,
        originalContent,
        newContent,
        timestamp: Date.now(),
        preview,
    });
    notify();
    return id;
}

export function getPendingChanges(): PendingChange[] {
    return [...pendingChanges];
}

export function hasPendingChanges(): boolean {
    return pendingChanges.length > 0;
}

export function clearPendingChanges(): void {
    pendingChanges = [];
    notify();
}

export function getCurrentReviewChange(): PendingChange | null {
    if (!isReviewMode || currentReviewIndex >= pendingChanges.length) {
        return null;
    }
    return pendingChanges[currentReviewIndex] ?? null;
}

export function getReviewProgress(): { current: number; total: number } {
    return { current: currentReviewIndex + 1, total: pendingChanges.length };
}

export function isInReviewMode(): boolean {
    return isReviewMode;
}

export async function startReview(): Promise<boolean[]> {
    if (pendingChanges.length === 0) {
        return [];
    }

    pendingChanges = mergePendingChangesByPath(pendingChanges);
    isReviewMode = true;
    currentReviewIndex = 0;
    reviewResults = [];
    notifyReviewMode();
    notify();

    return new Promise((resolve) => {
        reviewResolve = resolve;
    });
}

export function respondReview(approved: boolean): void {
    if (!isReviewMode || !reviewResolve) return;

    reviewResults.push(approved);
    currentReviewIndex++;

    if (currentReviewIndex >= pendingChanges.length) {
        const results = [...reviewResults];
        const resolve = reviewResolve;

        isReviewMode = false;
        currentReviewIndex = 0;
        reviewResults = [];
        reviewResolve = null;
        pendingChanges = [];

        notifyReviewMode();
        notify();

        resolve(results);
    } else {
        notify();
    }
}

export function acceptAllReview(): void {
    if (!isReviewMode || !reviewResolve) return;

    const results = [...reviewResults];
    while (results.length < pendingChanges.length) {
        results.push(true);
    }

    const resolve = reviewResolve;

    isReviewMode = false;
    currentReviewIndex = 0;
    reviewResults = [];
    reviewResolve = null;
    pendingChanges = [];

    notifyReviewMode();
    notify();

    resolve(results);
}

export function cancelReview(): void {
    if (!isReviewMode || !reviewResolve) return;

    const results = reviewResults.map(() => false);
    while (results.length < pendingChanges.length) {
        results.push(false);
    }

    const resolve = reviewResolve;

    isReviewMode = false;
    currentReviewIndex = 0;
    reviewResults = [];
    reviewResolve = null;
    pendingChanges = [];

    notifyReviewMode();
    notify();

    resolve(results);
}
