import { SyntaxStyle, RGBA } from '@cascadetui/core';
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
  const parsedLines = lines
    .map(line => line.replace(/\r$/, ''))
    .map(line => ({ line, parsed: parseDiffLine(line) }));
  const hasDiff = parsedLines.some(item => item.parsed.isDiffLine);
  if (!hasDiff) {
    return { diff: lines.join('\n'), isDiff: false };
  }

  const safePath = (filePath || 'file.txt').replace(/^[/\\]+/, '');
  const leftPath = `a/${safePath}`;
  const rightPath = `b/${safePath}`;
  const removedCount = parsedLines.filter(item => item.parsed.isDiffLine && item.parsed.isRemoved).length;
  const addedCount = parsedLines.filter(item => item.parsed.isDiffLine && item.parsed.isAdded).length;
  const oldStart = removedCount === 0 ? 0 : 1;
  const newStart = addedCount === 0 ? 0 : 1;

  const header = [
    `diff --git ${leftPath} ${rightPath}`,
    `--- ${leftPath}`,
    `+++ ${rightPath}`,
    `@@ -${oldStart},${removedCount} +${newStart},${addedCount} @@`,
  ];

  const body = parsedLines.map(({ line, parsed }) => {
    if (parsed.isDiffLine) {
      return `${parsed.prefix} ${parsed.content ?? ''}`;
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

export function renderDiffBlock(
  content: string,
  key: string,
  options?: { height?: number; filePath?: string; view?: "unified" | "split"; variant?: "default" | "critique" }
) {
  const lines = content.split('\n');
  const { diff, isDiff } = buildUnifiedDiff(lines, options?.filePath);
  const variant = options?.variant ?? "default";

  if (!isDiff) {
    return (
      <box key={key} flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <text key={`${key}-plain-${index}`} fg="#ffffff">{line || ' '}</text>
        ))}
      </box>
    );
  }

  const isCritique = variant === "critique";
  const text = isCritique ? "#d4d4d8" : "#E6EDF3";
  const lineNumberFg = isCritique ? "#a1a1aa" : "#E6EDF3";
  const lineNumberBg = isCritique ? "#000000" : "#141414";
  const addedBg = isCritique ? "#0f2d18" : "#0d2b0d";
  const removedBg = isCritique ? "#2c1116" : "#2b0d0d";
  const contextBg = isCritique ? "#000000" : "#141414";
  const addedContentBg = isCritique ? "#0f2d18" : "#1a3a1a";
  const removedContentBg = isCritique ? "#2c1116" : "#3a1a1a";
  const contextContentBg = isCritique ? "#000000" : "#141414";
  const addedLineNumberBg = isCritique ? "#0a1f11" : "#0d2b0d";
  const removedLineNumberBg = isCritique ? "#1f0b0f" : "#2b0d0d";

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
      fg={text}
      lineNumberFg={lineNumberFg}
      lineNumberBg={lineNumberBg}
      addedBg={addedBg}
      removedBg={removedBg}
      contextBg={contextBg}
      addedContentBg={addedContentBg}
      removedContentBg={removedContentBg}
      contextContentBg={contextContentBg}
      addedLineNumberBg={addedLineNumberBg}
      removedLineNumberBg={removedLineNumberBg}
      addedSignColor="#22c55e"
      removedSignColor="#ef4444"
    />
  );
}

export function renderInlineDiffLine(content: string, filetype?: string) {
  const parsed = parseDiffLine(content);
  if (parsed.isDiffLine) {
    const signColor = parsed.isAdded ? '#22c55e' : '#ef4444';
    const textColor = parsed.isAdded ? '#4ade80' : '#f87171';
    const resolvedFiletype = filetype ? (DIFF_FILETYPE_MAP[filetype] || filetype) : undefined;
    return (
      <box flexDirection="row">
        <text fg={signColor}>{` ${parsed.prefix}`}</text>
        <text fg="#6e7681">{parsed.lineNumber?.padStart(5) || '     '}</text>
        <text fg="#3a3a3a">{' '}</text>
        {resolvedFiletype ? (
          <code
            content={parsed.content || ' '}
            filetype={resolvedFiletype}
            syntaxStyle={DIFF_SYNTAX_STYLE}
            height={1}
            wrapMode="none"
          />
        ) : (
          <text fg={textColor}>{parsed.content || ''}</text>
        )}
      </box>
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
