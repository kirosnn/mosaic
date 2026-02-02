import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import type { PendingChange } from './pendingChangesBridge';

export async function revertChange(change: PendingChange): Promise<void> {
    const workspace = process.cwd();
    const fullPath = resolve(workspace, change.path);

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