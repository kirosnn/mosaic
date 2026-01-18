import { TextAttributes } from '@opentui/core';
import { parseDiffLine, getDiffLineColors } from './diff';

export function renderDiffLine(line: string, key: string) {
  const parsed = parseDiffLine(line);

  if (parsed.isDiffLine) {
    const colors = getDiffLineColors(parsed);

    return (
      <box key={key} flexDirection="row">
        <box backgroundColor={colors.labelBackground}>
          <text fg="#ffffff">
            {" "}{parsed.prefix}{parsed.lineNumber?.padStart(5) || ''}{' '}
          </text>
        </box>
        <box flexGrow={1} backgroundColor={colors.contentBackground}>
          <text fg="#ffffff">
            {" "}{parsed.content || ''}
          </text>
        </box>
      </box>
    );
  }

  return (
    <text key={key} fg="#ffffff">
      {line || ' '}
    </text>
  );
}

export function renderInlineDiffLine(content: string) {
  const parsed = parseDiffLine(content);

  if (parsed.isDiffLine) {
    const colors = getDiffLineColors(parsed);

    return (
      <>
        <box>
          <text fg="#ffffff">
            {parsed.prefix}{parsed.lineNumber?.padStart(5) || ''}{' '}
          </text>
        </box>
        <box backgroundColor={colors.contentBackground}>
          <text fg="#ffffff">
            {" "}{parsed.content || ''}
          </text>
        </box>
      </>
    );
  }

  return null;
}

export function getDiffLineBackground(content: string): string | null {
  const parsed = parseDiffLine(content);
  const colors = getDiffLineColors(parsed);
  return colors.contentBackground !== 'transparent' ? colors.contentBackground : null;
}