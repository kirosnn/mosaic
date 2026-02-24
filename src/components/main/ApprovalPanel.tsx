import { useEffect, useMemo, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { ApprovalRequest } from '../../utils/approvalBridge';
import { getBaseCommand } from '../../utils/commandPattern';

export type RuleAction = 'auto-run';

interface ApprovalPanelProps {
  request: ApprovalRequest;
  disabled?: boolean;
  onRespond: (approved: boolean, customResponse?: string, ruleAction?: RuleAction) => void;
}

interface ApprovalOption {
  label: string;
  hotkey: string;
  action: 'allow' | 'deny' | 'auto-run';
}

function getPreviewLines(request: ApprovalRequest, command: string): string[] {
  if (request.toolName === 'bash') {
    return [`$ ${command || '(empty command)'}`];
  }

  const raw = (request.preview.content || '').split('\n').map((line) => line.trimEnd());
  const nonEmpty = raw.filter((line) => line.trim().length > 0);
  const limited = nonEmpty.slice(0, 6);
  if (limited.length === 0) return ['(no preview)'];
  return limited;
}

function runOption(option: ApprovalOption, onRespond: (approved: boolean, customResponse?: string, ruleAction?: RuleAction) => void): void {
  if (option.action === 'allow') {
    onRespond(true);
    return;
  }
  if (option.action === 'auto-run') {
    onRespond(true, undefined, 'auto-run');
    return;
  }
  onRespond(false);
}

export function ApprovalPanel({ request, disabled = false, onRespond }: ApprovalPanelProps) {
  const isBash = request.toolName === 'bash';
  const command = isBash ? String(request.args.command ?? '').trim() : '';
  const baseCommand = command ? getBaseCommand(command) : '';
  const [selectedIndex, setSelectedIndex] = useState(0);

  const options = useMemo<ApprovalOption[]>(() => {
    if (!isBash) {
      return [
        { label: 'Yes, proceed', hotkey: 'y', action: 'allow' },
        { label: 'No, and tell Mosaic what to do differently', hotkey: 'n', action: 'deny' },
      ];
    }

    return [
      { label: 'Yes, proceed', hotkey: 'y', action: 'allow' },
      { label: `Yes, and do not ask again for commands that start with \`${baseCommand || command || 'command'}\``, hotkey: 'a', action: 'auto-run' },
      { label: 'No, and tell Mosaic what to do differently', hotkey: 'n', action: 'deny' },
    ];
  }, [baseCommand, command, isBash]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [request.id]);

  useKeyboard((key) => {
    if (disabled) return;
    const typed = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : '';

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex((prev) => (prev === 0 ? options.length - 1 : prev - 1));
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex((prev) => (prev === options.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const option = options[selectedIndex];
      if (option) runOption(option, onRespond);
      return;
    }

    if (key.name === 'escape') {
      onRespond(false);
      return;
    }

    if (typed === '1') {
      const option = options[0];
      if (option) runOption(option, onRespond);
      return;
    }

    if (typed === '2') {
      const option = options[1];
      if (option) runOption(option, onRespond);
      return;
    }

    if (typed === '3') {
      const option = options[2];
      if (option) runOption(option, onRespond);
      return;
    }

    if (typed === 'y') {
      const allow = options.find((option) => option.action === 'allow');
      if (allow) runOption(allow, onRespond);
      return;
    }

    if (typed === 'a' || typed === 'p') {
      const auto = options.find((option) => option.action === 'auto-run');
      if (auto) runOption(auto, onRespond);
      return;
    }

    if (typed === 'n' || typed === 'q') {
      const deny = options.find((option) => option.action === 'deny');
      if (deny) runOption(deny, onRespond);
    }
  });

  const runningTarget = isBash
    ? (command || 'command')
    : (request.preview.title || request.toolName);
  const introLine = isBash
    ? 'Would you like to run the following command?'
    : 'Would you like to run the following operation?';
  const previewLines = getPreviewLines(request, command);
  const reasonLine = request.preview.details?.[0];

  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row">
        <text fg="#9a9a9a">• </text>
        <text fg="#ffffff" attributes={TextAttributes.BOLD}>Running</text>
        <text fg="#9a9a9a" attributes={TextAttributes.DIM}>{` ${runningTarget}`}</text>
      </box>

      <text>{' '}</text>
      <text fg="#d4d4d8">{introLine}</text>

      {reasonLine ? (
        <box flexDirection="row" marginTop={1}>
          <text fg="#9a9a9a">Reason: </text>
          <text fg="#b8b8b8" attributes={TextAttributes.ITALIC}>{reasonLine}</text>
        </box>
      ) : null}

      <box flexDirection="column" marginTop={1}>
        {previewLines.map((line, index) => (
          <text key={`${request.id}-preview-${index}`} fg="#d4d4d8">{line || ' '}</text>
        ))}
      </box>

      <text>{' '}</text>

      <box flexDirection="column">
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          const prefix = `${index + 1}. `;
          const suffix = option.action === 'deny' ? ' (esc)' : ` (${option.hotkey})`;
          const rowAttributes = selected ? TextAttributes.BOLD : TextAttributes.DIM;
          const rowColor = '#ffffff';
          return (
            <box key={`${request.id}-option-${index}`} flexDirection="row">
              <text fg={rowColor} attributes={rowAttributes}>
                {selected ? '> ' : '  '}
              </text>
              <text fg={rowColor} attributes={rowAttributes}>{prefix}</text>
              <text fg={rowColor} attributes={rowAttributes}>{option.label}</text>
              <text fg={rowColor} attributes={rowAttributes}>{suffix}</text>
            </box>
          );
        })}
      </box>

      <text>{' '}</text>
      <text fg="#6f6f6f">Press enter to confirm or esc to cancel</text>
    </box>
  );
}
