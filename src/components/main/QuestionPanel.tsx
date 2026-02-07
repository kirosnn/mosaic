import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { CustomInput } from '../CustomInput';
import type { QuestionRequest } from '../../utils/questionBridge';

interface QuestionPanelProps {
  request: QuestionRequest;
  disabled?: boolean;
  onAnswer: (index: number, customText?: string) => void;
  maxWidth?: number;
}

export function QuestionPanel({ request, disabled = false, onAnswer, maxWidth }: QuestionPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(request.timeout ?? null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
    setHoveredIndex(null);
    setValidationError(null);
    setRemaining(request.timeout ?? null);
  }, [request.id]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining !== null]);

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
    if (request.validation) {
      try {
        if (!new RegExp(request.validation.pattern).test(text)) {
          setValidationError(request.validation.message || `Input must match: ${request.validation.pattern}`);
          return;
        }
      } catch {
        setValidationError('Invalid validation pattern');
        return;
      }
    }
    setValidationError(null);
    onAnswer(0, text);
  };

  let lastGroup: string | undefined;

  return (
    <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>Question</text>
        {remaining !== null && (
          <text fg={remaining <= 5 ? '#ff4444' : '#888888'}> Timeout: {remaining}s</text>
        )}
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
          const showGroupHeader = option.group && option.group !== lastGroup;
          lastGroup = option.group;
          return (
            <box key={`${request.id}-${index}`} flexDirection="column">
              {showGroupHeader && (
                <box paddingLeft={1} marginTop={index > 0 ? 1 : 0}>
                  <text fg="#888888" attributes={TextAttributes.BOLD}>{option.group}</text>
                </box>
              )}
              <box
                flexDirection="row"
                backgroundColor={selected ? '#2a2a2a' : (hoveredIndex === index ? '#202020' : 'transparent')}
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
                  onAnswer(index);
                }}
              >
                <text fg={selected ? '#ffca38' : 'white'} attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}>
                  {prefix}{number}{option.label}
                </text>
              </box>
            </box>
          );
        })}
      </box>

      {validationError && (
        <box marginBottom={1} paddingLeft={1}>
          <text fg="#ff4444">{validationError}</text>
        </box>
      )}

      <box flexDirection="row">
        <CustomInput onSubmit={handleCustomSubmit} placeholder="Tell Mosaic what it should do and press Enter" focused={!disabled} disableHistory={true} maxWidth={maxWidth} />
      </box>
    </box>
  );
}
