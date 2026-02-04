import { useRef } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { PendingChange } from '../../utils/pendingChangesBridge';
import { renderDiffBlock } from '../../utils/diffRendering';
import { parseDiffLine } from '../../utils/diff';

interface ReviewPanelProps {
    change: PendingChange;
    progress: { current: number; total: number };
}

export function ReviewPanel({ change, progress }: ReviewPanelProps) {
    const scrollboxRef = useRef<any>(null);

    const previewLines = change.preview.content.split('\n');
    const totalPreviewLines = Math.max(1, previewLines.length);
    const hasRemoved = previewLines.some((line) => {
        const parsed = parseDiffLine(line);
        return parsed.isDiffLine && parsed.isRemoved;
    });
    const diffView = hasRemoved ? "split" : "unified";

    useKeyboard((key) => {
        if (key.name === 'pageup') {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = Math.max(0, sb.scrollTop - 8);
            }
        }

        if (key.name === 'pagedown') {
            const sb = scrollboxRef.current;
            if (sb?.scrollTop !== undefined) {
                sb.scrollTop = sb.scrollTop + 8;
            }
        }
    });

    const titleMatch = change.preview.title.match(/^(.+?)\s*\((.+)\)$/);
    const toolName = titleMatch ? titleMatch[1] : change.preview.title;
    const toolInfo = titleMatch ? titleMatch[2] : null;
    const visibleContent = previewLines.join('\n');
    const summaryLabel = toolInfo ?? toolName;

    return (
        <box flexDirection="column" width="100%" height="100%" backgroundColor="#1a1a1a">
            <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
                <box flexDirection="row" justifyContent="space-between" width="100%">
                    <box flexDirection="row" alignItems="center">
                        <text fg="#e6e6e6" attributes={TextAttributes.BOLD}>Review</text>
                        {progress.total > 1 && (
                            <text fg="#8a8a8a" marginLeft={1}>({progress.current}/{progress.total})</text>
                        )}
                    </box>
                    <text fg="#8a8a8a" attributes={TextAttributes.DIM}>page up/down</text>
                </box>

                {summaryLabel && (
                    <box flexDirection="row" marginTop={1}>
                        <text fg="#b5b5b5" attributes={TextAttributes.DIM}>{summaryLabel}</text>
                    </box>
                )}
            </box>

            <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
                <scrollbox
                    ref={scrollboxRef}
                    scrollY
                    width="100%"
                    height="100%"
                    paddingLeft={1}
                    paddingRight={1}
                    paddingTop={1}
                >
                    {renderDiffBlock(visibleContent, `review-diff-${change.id}`, {
                        height: totalPreviewLines,
                        filePath: toolInfo ?? undefined,
                        view: diffView
                    })}
                </scrollbox>
            </box>
        </box>
    );
}
