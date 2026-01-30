import { TextAttributes } from '@opentui/core';
import { parseDiffLine, getDiffLineColors } from './diff';

export function renderDiffLine(line: string, key: string) {
  const parsed = parseDiffLine(line);

  if (parsed.isDiffLine) {
    const colors = getDiffLineColors(parsed);

    return (
      <box key={key} flexDirection="row" width="100%" alignItems="stretch">
        <box backgroundColor={colors.labelBackground} flexShrink={0}>
          <text fg="#ffffff">
            {" "}{parsed.prefix}{parsed.lineNumber?.padStart(5) || ''}{' '}
          </text>
        </box>
        <box flexGrow={1} backgroundColor={colors.contentBackground} minWidth={0}>
          <text fg="#ffffff">
            {" "}{parsed.content || ''}
          </text>
        </box>
      </box>
    );
  }

  return (
    <box key={key} width="100%">
      <text fg="#ffffff">
        {line || ' '}
      </text>
    </box>
  );
}

export function renderInlineDiffLine(content: string) {
  const parsed = parseDiffLine(content);
  if (parsed.isDiffLine) {
    return (
      <>
        <box>
          <text fg="white" attributes={TextAttributes.DIM}>
            {parsed.prefix}{parsed.lineNumber?.padStart(5) || ''}{' '}
          </text>
        </box>
        <box>
          <text fg="white">
            {" "}{parsed.content || ''}
          </text>
        </box>
      </>
    );
  }

  return null;
}

export function getDiffLineBackground(_content: string): string | null {
  return null;
}