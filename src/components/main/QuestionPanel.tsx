import { useState, useEffect, useMemo } from 'react';
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
  }, [request.id, request.timeout]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining !== null]);

  useKeyboard((key) => {
    if (disabled) return;

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex((prev) => (prev === 0 ? request.options.length - 1 : prev - 1));
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex((prev) => (prev === request.options.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      onAnswer(selectedIndex);
      return;
    }

    if (key.name === 'escape') {
      return;
    }

    const typed = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : '';
    if (/^[1-9]$/.test(typed)) {
      const idx = Number(typed) - 1;
      if (idx >= 0 && idx < request.options.length) onAnswer(idx);
    }
  });

  const handleCustomSubmit = (text: string) => {
    if (!text || !text.trim()) return;

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

  const promptLines = useMemo(() => {
    const raw = (request.prompt || '').split('\n').map((line) => line.trimEnd());
    return raw.length ? raw : [''];
  }, [request.prompt]);

  let lastGroup: string | undefined;

  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row">
        <text fg="#9a9a9a">• </text>
        <text fg="#ffffff" attributes={TextAttributes.BOLD}>Question</text>
        {remaining !== null ? (
          <text
            fg={remaining <= 5 ? '#ff4444' : '#9a9a9a'}
            attributes={remaining <= 5 ? TextAttributes.BOLD : TextAttributes.DIM}
          >
            {` Timeout: ${remaining}s`}
          </text>
        ) : null}
      </box>

      <text>{' '}</text>

      <box flexDirection="column">
        {promptLines.map((line, index) => (
          <text key={`${request.id}-prompt-${index}`} fg="#d4d4d8">
            {line || ' '}
          </text>
        ))}
      </box>

      <text>{' '}</text>

      <box flexDirection="column">
        {request.options.map((option, index) => {
          const selected = index === selectedIndex;
          const showGroupHeader = option.group && option.group !== lastGroup;
          lastGroup = option.group;

          const prefix = index <= 8 ? `${index + 1}. ` : '   ';
          const suffix = index <= 8 ? ` (${index + 1})` : '';
          const rowAttributes = selected ? TextAttributes.BOLD : TextAttributes.DIM;
          const rowColor = '#ffffff';

          return (
            <box key={`${request.id}-opt-${index}`} flexDirection="column">
              {showGroupHeader ? (
                <box flexDirection="row" marginTop={index > 0 ? 1 : 0}>
                  <text fg="#9a9a9a" attributes={TextAttributes.DIM}>{option.group}</text>
                </box>
              ) : null}

              <box
                flexDirection="row"
                onMouseOver={() => {
                  if (disabled) return;
                  setHoveredIndex(index);
                }}
                onMouseOut={() => {
                  setHoveredIndex((prev) => (prev === index ? null : prev));
                }}
                onMouseDown={(event: any) => {
                  if (disabled) return;
                  if (event?.isSelecting) return;
                  if (event?.button !== undefined && event.button !== 0) return;
                  setSelectedIndex(index);
                  onAnswer(index);
                }}
              >
                <text fg={rowColor} attributes={rowAttributes}>
                  {selected ? '> ' : '  '}
                </text>
                <text fg={rowColor} attributes={rowAttributes}>{prefix}</text>
                <text
                  fg={rowColor}
                  attributes={hoveredIndex === index && !selected ? TextAttributes.NONE : rowAttributes}
                >
                  {option.label}
                </text>
                <text fg={rowColor} attributes={rowAttributes}>{suffix}</text>
              </box>
            </box>
          );
        })}
      </box>

      {validationError ? (
        <box flexDirection="row" marginTop={1}>
          <text fg="#ff4444" attributes={TextAttributes.BOLD}>{validationError}</text>
        </box>
      ) : null}

      <text>{' '}</text>

      <box flexDirection="row">
        <CustomInput
          onSubmit={handleCustomSubmit}
          placeholder="Tell Mosaic what it should do and press Enter"
          focused={!disabled}
          disableHistory={true}
          maxWidth={maxWidth}
        />
      </box>
    </box>
  );
}