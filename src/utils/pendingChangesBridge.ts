export interface PendingChange {
    id: string;
    type: 'write' | 'edit';
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
    type: 'write' | 'edit',
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