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

const TOOL_COLORS = {
  write: '#4ade80',
  edit: '#60a5fa',
  bash: '#f87171',
} as const;

const TOOL_LABELS = {
  write: 'Write File',
  edit: 'Edit File',
  bash: 'Execute Command',
} as const;

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

  const toolColor = TOOL_COLORS[request.toolName];
  const toolLabel = TOOL_LABELS[request.toolName];

  return (
    <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg={toolColor} attributes={TextAttributes.BOLD}>
          {request.preview.title}
        </text>
      </box>

      <box
        flexDirection="column"
        marginBottom={1}
        backgroundColor="#0a0a0a"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <text attributes={TextAttributes.DIM}>{request.preview.content}</text>
      </box>

      <box flexDirection="column" marginBottom={1}>
        {allOptions.map((option, index) => {
          const selected = index === selectedIndex;
          const isApprove = index === 0;
          const color = isApprove ? '#4ade80' : '#f87171';

          return (
            <box
              key={`${request.id}-${index}`}
              flexDirection="row"
              backgroundColor={selected ? '#2a2a2a' : 'transparent'}
              paddingLeft={1}
              paddingRight={1}
            >
              <text
                fg={selected ? color : 'white'}
                attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}
              >
                {selected ? '> ' : '  '}{option}
              </text>
            </box>
          );
        })}
      </box>

      <box flexDirection="row">
        <CustomInput onSubmit={handleCustomSubmit} placeholder="Tell Mosaic what to do instead and press Enter" focused={!disabled} />
      </box>
    </box>
  );
}