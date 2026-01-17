import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { CustomInput } from '../CustomInput';
import type { QuestionRequest } from '../../utils/questionBridge';

interface QuestionPanelProps {
  request: QuestionRequest;
  disabled?: boolean;
  onAnswer: (index: number, customText?: string) => void;
}

export function QuestionPanel({ request, disabled = false, onAnswer }: QuestionPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [request.id]);

  useKeyboard((key) => {
    if (disabled) return;

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex(prev => (prev === 0 ? request.options.length - 1 : prev - 1));
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(prev => (prev === request.options.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.name === 'return') {
      onAnswer(selectedIndex);
      return;
    }

    if (key.name && /^[1-9]$/.test(key.name)) {
      const idx = Number(key.name) - 1;
      if (idx >= 0 && idx < request.options.length) {
        onAnswer(idx);
      }
    }
  });

  const handleCustomSubmit = (text: string) => {
    if (!text || !text.trim()) {
      return;
    }
    onAnswer(0, text);
  };

  return (
    <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>Question</text>
      </box>

      <box flexDirection="column" marginBottom={1}>
        {request.prompt.split('\n').map((line, index) => (
          <text key={`prompt-line-${index}`} attributes={TextAttributes.BOLD}>{line || ' '}</text>
        ))}
      </box>

      <box flexDirection="column" marginBottom={1}>
        {request.options.map((option, index) => {
          const selected = index === selectedIndex;
          const prefix = selected ? '> ' : '  ';
          const number = index <= 8 ? `${index + 1}. ` : '   ';
          return (
            <box key={`${request.id}-${index}`} flexDirection="row" backgroundColor={selected ? '#2a2a2a' : 'transparent'} paddingLeft={1} paddingRight={1}>
              <text fg={selected ? '#ffca38' : 'white'} attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}>
                {prefix}{number}{option.label}
              </text>
            </box>
          );
        })}
      </box>

      <box flexDirection="row">
        <CustomInput onSubmit={handleCustomSubmit} placeholder="Tell Mosaic what it should do and press Enter" focused={!disabled} disableHistory={true} />
      </box>
    </box>
  );
}