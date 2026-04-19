import { writeFile, mkdir, unlink } from 'fs/promises';
import { dirname } from 'path';
import type { PendingChange } from './pendingChangesBridge';
import { resolveReviewPath } from '../agent/toolPathScope';

export async function revertChange(change: PendingChange): Promise<void> {
    const workspace = process.cwd();
    const fullPath = resolveReviewPath(workspace, change.path);

    const wasCreatedByChange = change.originalContent === '' && change.newContent !== '';
    if (wasCreatedByChange) {
        try {
            await unlink(fullPath);
        } catch (error) {
            const e = error as NodeJS.ErrnoException;
            if (e?.code !== 'ENOENT') throw error;
        }
        return;
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, change.originalContent, 'utf-8');
}

export async function revertChanges(changes: PendingChange[], approvals: boolean[]): Promise<number> {
    let revertedCount = 0;

    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        const approved = approvals[i];

        if (change && !approved) {
            await revertChange(change);
            revertedCount++;
        }
    }

    return revertedCount;
}
