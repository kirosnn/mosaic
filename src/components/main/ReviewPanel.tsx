import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { PendingChange } from '../../utils/pendingChangesBridge';
import { renderDiffLine } from '../../utils/diffRendering';

interface ReviewPanelProps {
    change: PendingChange;
    progress: { current: number; total: number };
    disabled?: boolean;
    onRespond: (approved: boolean) => void;
    onRevert: () => void;
}

export function ReviewPanel({ change, progress, disabled = false, onRespond, onRevert }: ReviewPanelProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);

    useEffect(() => {
        setSelectedIndex(0);
        setScrollOffset(0);
    }, [change.id]);

    const previewLines = change.preview.content.split('\n');
    const maxVisiblePreviewLines = 15;
    const canScroll = previewLines.length > maxVisiblePreviewLines;

    useKeyboard((key) => {
        if (disabled) return;

        if ((key.name === 'up' || key.name === 'k') && key.shift && canScroll) {
            setScrollOffset(prev => Math.max(0, prev - 1));
            return;
        }

        if ((key.name === 'down' || key.name === 'j') && key.shift && canScroll) {
            setScrollOffset(prev => Math.min(previewLines.length - maxVisiblePreviewLines, prev + 1));
            return;
        }

        if (key.name === 'up' || key.name === 'k') {
            setSelectedIndex(prev => (prev === 0 ? 1 : prev - 1));
            return;
        }

        if (key.name === 'down' || key.name === 'j') {
            setSelectedIndex(prev => (prev === 1 ? 0 : prev + 1));
            return;
        }

        if (key.name === 'return') {
            if (selectedIndex === 0) {
                onRespond(true);
            } else {
                onRevert();
                onRespond(false);
            }
            return;
        }

        if (key.name === 'y') {
            onRespond(true);
            return;
        }

        if (key.name === 'n' || key.name === 'r') {
            onRevert();
            onRespond(false);
            return;
        }
    });

    const titleMatch = change.preview.title.match(/^(.+?)\s*\((.+)\)$/);
    const toolName = titleMatch ? titleMatch[1] : change.preview.title;
    const toolInfo = titleMatch ? titleMatch[2] : null;

    return (
        <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
            <box flexDirection="row" marginBottom={1} justifyContent="space-between">
                <box flexDirection="row">
                    <text fg="#ffca38" attributes={TextAttributes.BOLD}>Review Changes</text>
                    <text fg="#808080" marginLeft={1}>({progress.current}/{progress.total})</text>
                </box>
            </box>

            <box flexDirection="row" marginBottom={1}>
                <text fg={"#ffffff"}>{toolName}</text>
                {toolInfo && (
                    <>
                        <text fg={"#ffffff"}> </text>
                        <text fg={"#ffffff"} attributes={TextAttributes.DIM}>({toolInfo})</text>
                    </>
                )}
            </box>

            <box
                flexDirection="column"
                marginBottom={1}
                paddingLeft={1}
                paddingRight={1}
                paddingBottom={1}
            >
                {previewLines.slice(scrollOffset, scrollOffset + maxVisiblePreviewLines).map((line, displayIndex) => {
                    const index = scrollOffset + displayIndex;
                    return renderDiffLine(line, `review-line-${index}`);
                })}
                {canScroll && (
                    <text fg="#808080" attributes={TextAttributes.DIM}>
                        {scrollOffset > 0 ? '^ ' : '  '}
                        Line {scrollOffset + 1}-{Math.min(scrollOffset + maxVisiblePreviewLines, previewLines.length)} of {previewLines.length}
                        {scrollOffset + maxVisiblePreviewLines < previewLines.length ? ' v' : ''}
                        {' (Shift+Up/Down to scroll)'}
                    </text>
                )}
            </box>

            <box flexDirection="column">
                <box
                    flexDirection="row"
                    backgroundColor='transparent'
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={selectedIndex === 0 ? '#22c55e' : 'white'}
                        attributes={selectedIndex === 0 ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {selectedIndex === 0 ? '> ' : '  '}Keep (y)
                    </text>
                </box>
                <box
                    flexDirection="row"
                    backgroundColor='transparent'
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={selectedIndex === 1 ? '#ef4444' : 'white'}
                        attributes={selectedIndex === 1 ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {selectedIndex === 1 ? '> ' : '  '}Revert (r)
                    </text>
                </box>
            </box>
        </box>
    );
}