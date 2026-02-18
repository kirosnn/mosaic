import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { CustomInput } from '../CustomInput';
import type { ApprovalRequest } from '../../utils/approvalBridge';
import { renderDiffBlock } from '../../utils/diffRendering';
import { getBaseCommand } from '../../utils/commandPattern';

export type RuleAction = 'auto-run';

interface ApprovalPanelProps {
  request: ApprovalRequest;
  disabled?: boolean;
  onRespond: (approved: boolean, customResponse?: string, ruleAction?: RuleAction) => void;
  maxWidth?: number;
}

export function ApprovalPanel({ request, disabled = false, onRespond, maxWidth }: ApprovalPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isBash = request.toolName === 'bash';
  const bashCommand = isBash ? String(request.args.command ?? '') : '';
  const bashBaseCommand = bashCommand ? getBaseCommand(bashCommand) : '';
  const allOptions = isBash ? ['Allow execution', 'Always allow execution for', 'Deny execution'] : ['Yes', 'No'];

  useEffect(() => {
    setSelectedIndex(0);
    setHoveredIndex(null);
    setScrollOffset(0);
  }, [request.id]);

  const previewLines = request.preview.content.split('\n');
  const maxVisiblePreviewLines = 15;
  const canScroll = previewLines.length > maxVisiblePreviewLines;
  const executeSelection = (index: number) => {
    const option = allOptions[index];
    if (option === 'Allow execution') {
      onRespond(true);
    } else if (option === 'Always allow execution for') {
      onRespond(true, undefined, 'auto-run');
    } else {
      onRespond(false);
    }
  };

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
      setSelectedIndex(prev => (prev === 0 ? allOptions.length - 1 : prev - 1));
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(prev => (prev === allOptions.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.name === 'return') {
      executeSelection(selectedIndex);
      return;
    }
  });

  const handleCustomSubmit = (text: string) => {
    if (!text || !text.trim()) {
      return;
    }
    onRespond(false, text);
  };


  const titleMatch = request.preview.title.match(/^(.+?)\s*\((.+)\)$/);
  const toolName = titleMatch ? titleMatch[1] : request.preview.title;
  const toolInfo = titleMatch ? titleMatch[2] : null;
  const visibleContent = previewLines.slice(scrollOffset, scrollOffset + maxVisiblePreviewLines).join('\n');

  return (
    <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
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
        {renderDiffBlock(visibleContent, `preview-diff-${request.id}`, {
          height: maxVisiblePreviewLines,
          filePath: toolInfo ?? undefined,
          view: "split"
        })}
        {canScroll && (
          <text fg="#808080" attributes={TextAttributes.DIM}>
            {scrollOffset > 0 ? '↑ ' : '  '}
            Line {scrollOffset + 1}-{Math.min(scrollOffset + maxVisiblePreviewLines, previewLines.length)} of {previewLines.length}
            {scrollOffset + maxVisiblePreviewLines < previewLines.length ? ' ↓' : ''}
            {' (Shift+↑/↓ to scroll)'}
          </text>
        )}
      </box>

      <box flexDirection="column">
        {allOptions.map((option, index) => {
          const selected = index === selectedIndex;
          const hovered = hoveredIndex === index;

          return (
            <box
              key={`${request.id}-${index}`}
              flexDirection="row"
              backgroundColor={selected ? '#2a2a2a' : (hovered ? '#202020' : 'transparent')}
              paddingLeft={1}
              paddingRight={1}
              onMouseOver={() => {
                if (disabled) return;
                setHoveredIndex(index);
              }}
              onMouseOut={() => {
                setHoveredIndex(prev => (prev === index ? null : prev));
              }}
              onMouseDown={(event: any) => {
                if (disabled) return;
                if (event?.isSelecting) return;
                if (event?.button !== undefined && event.button !== 0) return;
                setSelectedIndex(index);
                executeSelection(index);
              }}
            >
              <text
                fg={selected ? '#e6e6e6' : 'white'}
                attributes={selected ? TextAttributes.BOLD : TextAttributes.DIM}
              >
                {selected ? '> ' : '  '}{option}
              </text>
              {option === 'Always allow execution for' && bashBaseCommand ? (
                <text> "{bashBaseCommand}"</text>
              ) : null}
            </box>
          );
        })}
      </box>

      <box flexDirection="row" paddingLeft={1} >
        <CustomInput onSubmit={handleCustomSubmit} placeholder="> Tell Mosaic what to do instead and press Enter" focused={!disabled} disableHistory={true} maxWidth={maxWidth} />
      </box>
    </box>
  );
}
