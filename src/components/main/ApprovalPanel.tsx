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
  const allOptions = ['Yes', 'No'];

  useEffect(() => {
    setSelectedIndex(0);
  }, [request.id]);

  useKeyboard((key) => {
    if (disabled) return;

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
        {request.preview.content.split('\n').map((line, index) => (
          <text key={`preview-line-${index}`} fg={"#ffffff"}>{line || ' '}</text>
        ))}
      </box>

      <box flexDirection="column" marginBottom={1}>
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

      <box flexDirection="row">
        <CustomInput onSubmit={handleCustomSubmit} placeholder="Tell Mosaic what to do instead and press Enter" focused={!disabled} disableHistory={true} />
      </box>
    </box>
  );
}