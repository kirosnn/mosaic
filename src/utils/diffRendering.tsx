import { TextAttributes, SyntaxStyle, RGBA } from '@opentui/core';
import { parseDiffLine, getDiffLineColors } from './diff';

const DIFF_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex("#E6EDF3") },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
});

const DIFF_FILETYPE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  md: "markdown",
  markdown: "markdown",
};

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

function buildUnifiedDiff(lines: string[], filePath?: string): { diff: string; isDiff: boolean } {
  const parsedLines = lines.map(line => ({ line, parsed: parseDiffLine(line) }));
  const hasDiff = parsedLines.some(item => item.parsed.isDiffLine);
  if (!hasDiff) {
    return { diff: lines.join('\n'), isDiff: false };
  }

  const safePath = (filePath || 'file.txt').replace(/^[/\\]+/, '');
  const leftPath = `a/${safePath}`;
  const rightPath = `b/${safePath}`;
  const removedCount = parsedLines.filter(item => item.parsed.isDiffLine && item.parsed.isRemoved).length;
  const addedCount = parsedLines.filter(item => item.parsed.isDiffLine && item.parsed.isAdded).length;

  const header = [
    `diff --git ${leftPath} ${rightPath}`,
    `--- ${leftPath}`,
    `+++ ${rightPath}`,
    `@@ -1,${removedCount} +1,${addedCount} @@`,
  ];

  const body = parsedLines.map(({ line, parsed }) => {
    if (parsed.isDiffLine) {
      return `${parsed.prefix}${parsed.content ?? ''}`;
    }
    return ` ${line}`;
  });

  return { diff: [...header, ...body].join('\n'), isDiff: true };
}

function getFiletypeFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const match = filePath.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) return undefined;
  const ext = match[1]?.toLowerCase() || '';
  return DIFF_FILETYPE_MAP[ext];
}

export function renderDiffBlock(content: string, key: string, options?: { height?: number; filePath?: string; view?: "unified" | "split" }) {
  const lines = content.split('\n');
  const { diff, isDiff } = buildUnifiedDiff(lines, options?.filePath);

  if (!isDiff) {
    return (
      <box key={key} flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <text key={`${key}-plain-${index}`} fg="#ffffff">{line || ' '}</text>
        ))}
      </box>
    );
  }

  return (
    <diff
      key={key}
      diff={diff}
      view={options?.view ?? "split"}
      width="100%"
      height={options?.height}
      filetype={getFiletypeFromPath(options?.filePath)}
      syntaxStyle={DIFF_SYNTAX_STYLE}
      showLineNumbers={true}
      wrapMode="none"
      fg="#E6EDF3"
      lineNumberFg="#E6EDF3"
      lineNumberBg="#141414"
      addedBg="#0d2b0d"
      removedBg="#2b0d0d"
      contextBg="#141414"
      addedContentBg="#1a3a1a"
      removedContentBg="#3a1a1a"
      contextContentBg="#141414"
      addedLineNumberBg="#0d2b0d"
      removedLineNumberBg="#2b0d0d"
      addedSignColor="#22c55e"
      removedSignColor="#ef4444"
    />
  );
}

export function renderInlineDiffLine(content: string) {
  const parsed = parseDiffLine(content);
  if (parsed.isDiffLine) {
    const colors = getDiffLineColors(parsed);
    return (
      <>
        <box backgroundColor={colors.labelBackground}>
          <text fg="white" attributes={TextAttributes.DIM}>
            {" "}{parsed.prefix}{parsed.lineNumber?.padStart(5) || ''}{' '}
          </text>
        </box>
        <box backgroundColor={colors.contentBackground}>
          <text fg="white">
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
  if (!parsed.isDiffLine) return null;
  const colors = getDiffLineColors(parsed);
  return colors.contentBackground || null;
}
