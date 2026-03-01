import { useMemo, useRef } from 'react';
import { homedir } from 'os';
import { TextAttributes } from '@cascadetui/core';
import { useKeyboard } from '@cascadetui/react';
import type { PendingChange } from '../../utils/pendingChangesBridge';
import { renderDiffBlock } from '../../utils/diffRendering';
import { parseDiffLine } from '../../utils/diff';

interface ReviewPanelProps {
    change: PendingChange;
    progress: { current: number; total: number };
    onKeep: () => void;
    onRevert: () => void;
    onAcceptAll: () => void;
}

function formatPathForHeader(inputPath: string): string {
    const normalizedPath = inputPath.replace(/\\/g, '/');
    const normalizedHome = homedir().replace(/\\/g, '/');
    const lowerPath = normalizedPath.toLowerCase();
    const lowerHome = normalizedHome.toLowerCase();

    if (lowerPath === lowerHome) {
        return '~';
    }

    if (lowerPath.startsWith(`${lowerHome}/`)) {
        return `~/${normalizedPath.slice(normalizedHome.length + 1)}`;
    }

    return normalizedPath;
}

export function ReviewPanel({ change, progress, onKeep, onRevert, onAcceptAll }: ReviewPanelProps) {
    const scrollboxRef = useRef<any>(null);
    const workspacePath = useMemo(() => formatPathForHeader(process.cwd()), []);

    const previewLines = change.preview.content.split('\n');
    const totalPreviewLines = Math.max(1, previewLines.length);
    const diffStats = useMemo(() => {
        let added = 0;
        let removed = 0;
        for (const line of previewLines) {
            const parsed = parseDiffLine(line);
            if (!parsed.isDiffLine) continue;
            if (parsed.isAdded) added++;
            if (parsed.isRemoved) removed++;
        }
        return { added, removed };
    }, [previewLines]);
    const hasRemoved = diffStats.removed > 0;
    const hasAdded = diffStats.added > 0;
    const diffView = hasRemoved && hasAdded ? "split" : "unified";
    const titleMatch = change.preview.title.match(/^(.+?)\s*\((.+)\)$/);
    const filePath = titleMatch?.[2] ?? change.path;
    const visibleContent = previewLines.join('\n');

    useKeyboard((key) => {
        const typed = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : '';

        if (typed === 'q' || key.name === 'q') {
            onRevert();
            return;
        }

        if (key.name === 'return' || key.name === 'enter') {
            onKeep();
            return;
        }

        if (typed === 'a' && (key.ctrl || key.meta)) {
            onAcceptAll();
            return;
        }

        if (key.name === 'pageup') {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = Math.max(0, sb.scrollTop - 12);
            }
            return;
        }

        if (key.name === 'pagedown') {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = sb.scrollTop + 12;
            }
            return;
        }

        if (key.name === 'g') {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = 0;
            }
            return;
        }

        if (key.name === 'g' && key.shift) {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = Number.MAX_SAFE_INTEGER;
            }
            return;
        }

    });

    return (
        <box flexDirection="column" width="100%" height="100%">
            <box flexDirection="column" width="100%" paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
                <box flexDirection="row" justifyContent="center" width="100%">
                    <text fg="#d4d4d8" attributes={TextAttributes.BOLD}>{workspacePath}</text>
                </box>

                <box flexDirection="row" width="100%" marginTop={1} alignItems="center">
                    <box flexDirection="row" alignItems="center">
                        <text fg="#ffffff">{'← '}</text>
                        <text fg="#ffffff" attributes={TextAttributes.DIM}>{'prev'}</text>
                    </box>
                    <box flexGrow={1} flexDirection="row" justifyContent="center" minWidth={0}>
                        <text fg="#e4e4e7">{filePath}</text>
                        <text fg="#22c55e">{`  +${diffStats.added}`}</text>
                        <text fg="#ef4444">{` -${diffStats.removed}`}</text>
                    </box>
                    <box flexDirection="row" alignItems="center">
                        <text fg="#ffffff">{'→ '}</text>
                        <text fg="#ffffff" attributes={TextAttributes.DIM}>{'next'}</text>
                    </box>
                </box>
            </box>

            <box flexDirection="column" flexGrow={1} paddingLeft={0} paddingRight={0} paddingTop={0} paddingBottom={0}>
                <scrollbox
                    ref={scrollboxRef}
                    scrollY
                    width="100%"
                    height="100%"
                    paddingLeft={0}
                    paddingRight={0}
                    paddingTop={0}
                    verticalScrollbarOptions={{
                        showArrows: false,
                        trackOptions: {
                            backgroundColor: "#111111",
                            foregroundColor: "#111111",
                        },
                    }}
                    horizontalScrollbarOptions={{
                        showArrows: false,
                        trackOptions: {
                            backgroundColor: "#111111",
                            foregroundColor: "#111111",
                        },
                    }}
                >
                    {renderDiffBlock(visibleContent, `review-diff-${change.id}`, {
                        height: totalPreviewLines,
                        filePath,
                        view: diffView,
                        variant: "critique",
                    })}
                </scrollbox>
            </box>

            <box flexDirection="column" width="100%" paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
                <box flexDirection="row" justifyContent="space-between" width="100%">
                    <box flexDirection="row" alignItems="center">
                        <text fg="#ffffff">{'q '}</text>
                        <text fg="#ffffff" attributes={TextAttributes.DIM}>{'deny'}</text>
                    </box>
                    <box flexDirection="row" alignItems="center">
                        <text fg="#ffffff" attributes={TextAttributes.DIM}>{`files (${Math.max(1, progress.current)}/${Math.max(1, progress.total)})`}</text>
                    </box>
                    <box flexDirection="row" alignItems="center">
                        <text fg="#ffffff">{'enter '}</text>
                        <text fg="#ffffff" attributes={TextAttributes.DIM}>{'validate file'}</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
