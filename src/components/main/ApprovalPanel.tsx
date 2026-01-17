import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { CustomInput } from '../CustomInput';
import type { ApprovalRequest } from '../../utils/approvalBridge';

interface ApprovalPanelProps {
  request: ApprovalRequest;
  disabled?: boolean;
  onRespond: (approved: boolean, customResponse?: string) => void;
}

export function ApprovalPanel({ request, disabled = false, onRespond }: ApprovalPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const allOptions = ['Yes', 'No'];

  useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [request.id]);

  const previewLines = request.preview.content.split('\n');
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
      setSelectedIndex(prev => (prev === 0 ? allOptions.length - 1 : prev - 1));
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(prev => (prev === allOptions.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.name === 'return') {
      if (selectedIndex === 0) {
        onRespond(true);
      } else {
        onRespond(false);
      }
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
        {previewLines.slice(scrollOffset, scrollOffset + maxVisiblePreviewLines).map((line, displayIndex) => {
          const index = scrollOffset + displayIndex;
          const isDiffLine = line.match(/^([+-])\s*(\d+)\s*\|\s*(.*)$/);

          if (isDiffLine) {
            const [, prefix, lineNum, content] = isDiffLine;
            const isAdded = prefix === '+';
            const isRemoved = prefix === '-';

            return (
              <box key={`preview-line-${index}`} flexDirection="row">
                <box backgroundColor={isAdded ? "#0d2b0d" : isRemoved ? "#2b0d0d" : "transparent"}>
                  <text fg="#ffffff">
                    {prefix}{lineNum?.padStart(4) || ''} |{' '}
                  </text>
                </box>
                <box flexGrow={1} backgroundColor={isAdded ? "#1a3a1a" : isRemoved ? "#3a1a1a" : "transparent"}>
                  <text fg="#ffffff">
                    {content || ''}
                  </text>
                </box>
              </box>
            );
          }

          return (
            <text key={`preview-line-${index}`} fg={"#ffffff"}>
              {line || ' '}
            </text>
          );
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

          return (
            <box
              key={`${request.id}-${index}`}
              flexDirection="row"
              backgroundColor='transparent'
              paddingLeft={1}
              paddingRight={1}
            >
              <text
                fg='white'
                attributes={selected ? TextAttributes.NONE : TextAttributes.DIM}
              >
                {selected ? '> ' : '  '}{option}
              </text>
            </box>
          );
        })}
      </box>

      <box flexDirection="row" paddingLeft={1} >
        <CustomInput onSubmit={handleCustomSubmit} placeholder="> Tell Mosaic what to do instead and press Enter" focused={!disabled} disableHistory={true} />
      </box>
    </box>
  );
}