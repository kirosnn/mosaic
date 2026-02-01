import { TextAttributes } from "@opentui/core";

export interface MarkdownSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'heading' | 'listitem' | 'link';
  content: string;
  level?: number;
  href?: string;
}

const linkSchemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function normalizeLinkUri(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  if (linkSchemePattern.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.') || trimmed.startsWith('?')) return trimmed;
  return `https://${trimmed}`;
}

function parseInline(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];

  let i = 0;
  let buffer = '';

  const flushText = () => {
    if (buffer) {
      segments.push({ type: 'text', content: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      if (j !== -1) {
        flushText();
        segments.push({ type: 'code', content: text.substring(i + 1, j) });
        i = j + 1;
        continue;
      }
    }

    if (text.substring(i, i + 2) === '**') {
      const j = text.indexOf('**', i + 2);
      if (j !== -1) {
        flushText();
        segments.push({ type: 'bold', content: text.substring(i + 2, j) });
        i = j + 2;
        continue;
      }
    }

    if (text[i] === '[') {
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const urlEnd = text.indexOf(')', labelEnd + 2);
        if (urlEnd !== -1) {
          const label = text.substring(i + 1, labelEnd);
          const href = text.substring(labelEnd + 2, urlEnd).trim();
          flushText();
          segments.push({ type: 'link', content: label, href });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    if (text[i] === '*' && text.substring(i, i + 2) !== '**') {
      const j = text.indexOf('*', i + 1);
      if (j !== -1) {
        flushText();
        segments.push({ type: 'italic', content: text.substring(i + 1, j) });
        i = j + 1;
        continue;
      }
    }

    buffer += text[i];
    i++;
  }

  flushText();
  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

export function parseMarkdownLine(line: string): MarkdownSegment[] {
  if (line.match(/^#{1,6}\s/)) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[2]) {
      return [{ type: 'heading', content: match[2], level: match[1]?.length || 1 }];
    }
  }

  if (line.match(/^[-*+]\s/)) {
    const content = line.replace(/^[-*+]\s+/, '');
    return [{ type: 'text', content: '• ' }, ...parseInline(content)];
  }

  return parseInline(line);
}

export function renderMarkdownSegment(segment: MarkdownSegment, key: number) {
  switch (segment.type) {
    case 'bold':
      return <text key={key} fg="white" attributes={TextAttributes.BOLD}>{segment.content}</text>;

    case 'italic':
      return <text key={key} fg="white" attributes={TextAttributes.DIM}>{segment.content}</text>;

    case 'code':
      return <text key={key} fg="#ffdd80">{`${segment.content}`}</text>;

    case 'heading':
      return <text key={key} fg="#ffca38" attributes={TextAttributes.BOLD}>{segment.content}</text>;

    case 'link':
      return <text key={key} fg="#7fbfff" attributes={TextAttributes.UNDERLINE}>{segment.content}</text>;

    case 'listitem':
      return (
        <box key={key} flexDirection="row">
          <text fg="#ffca38">• </text>
          <text>{segment.content}</text>
        </box>
      );

    case 'text':
    default:
      return <text key={key} fg="white">{segment.content}</text>;
  }
}

export interface ParsedMarkdownLine {
  segments: MarkdownSegment[];
  rawLine: string;
}

export function parseMarkdownContent(content: string): ParsedMarkdownLine[] {
  const lines = content.split('\n');
  const result: ParsedMarkdownLine[] = [];

  for (const line of lines) {
    result.push({
      segments: parseMarkdownLine(line),
      rawLine: line
    });
  }

  return result;
}

export function wrapMarkdownText(text: string, maxWidth: number): { text: string; segments: MarkdownSegment[] }[] {
  if (!text || maxWidth <= 0) return [{ text: '', segments: [] }];

  const segments = parseMarkdownLine(text);
  const lines: { text: string; segments: MarkdownSegment[] }[] = [];
  let currentLine = '';
  let currentSegments: MarkdownSegment[] = [];

  const splitSegment = (segment: MarkdownSegment): MarkdownSegment[] => {
    if (segment.type === 'code') return [segment];
    const parts = segment.content.match(/\s+|[^\s]+/g);
    if (!parts) return [segment];
    return parts.map(part => ({ ...segment, content: part }));
  };

  const pushLine = () => {
    if (!currentLine) return;
    lines.push({ text: currentLine, segments: currentSegments });
    currentLine = '';
    currentSegments = [];
  };

  const addPiece = (piece: MarkdownSegment) => {
    let remaining = piece.content;
    while (remaining.length > 0) {
      if (!currentLine) {
        if (remaining.trim() === '') {
          return;
        }
        if (remaining.length <= maxWidth) {
          currentLine = remaining;
          currentSegments = [{ ...piece, content: remaining }];
          return;
        }
        const chunk = remaining.slice(0, maxWidth);
        lines.push({ text: chunk, segments: [{ ...piece, content: chunk }] });
        remaining = remaining.slice(maxWidth);
        continue;
      }

      if ((currentLine + remaining).length <= maxWidth) {
        currentLine += remaining;
        currentSegments.push({ ...piece, content: remaining });
        return;
      }

      pushLine();
    }
  };

  for (const segment of segments) {
    const pieces = splitSegment(segment);
    for (const piece of pieces) {
      addPiece(piece);
    }
  }

  if (currentLine) {
    lines.push({ text: currentLine, segments: currentSegments });
  }

  for (const line of lines) {
    const merged: MarkdownSegment[] = [];
    for (const seg of line.segments) {
      const prev = merged.length > 0 ? merged[merged.length - 1] : undefined;
      if (prev && prev.type === seg.type && prev.href === seg.href && prev.level === seg.level) {
        prev.content += seg.content;
      } else {
        merged.push({ ...seg });
      }
    }
    line.segments = merged;
  }

  return lines.length > 0 ? lines : [{ text: '', segments: [] }];
}

export interface WrappedMarkdownBlock {
  type: 'line' | 'code' | 'table';
  wrappedLines?: { text: string; segments: MarkdownSegment[] }[];
  codeLines?: string[];
  tableRows?: string[][];
  columnWidths?: number[];
  tableCellLines?: string[][][];
  language?: string;
}

function wrapCodeLine(line: string, maxWidth: number): string[] {
  if (!line) return [''];
  if (maxWidth <= 0) return [line];
  if (line.length <= maxWidth) return [line];

  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push(line.slice(i, i + maxWidth));
    i += maxWidth;
  }
  return chunks;
}

function wrapCellText(text: string, maxWidth: number): string[] {
  if (!text) return [''];
  if (maxWidth <= 0) return [text];
  if (text.length <= maxWidth) return [text];

  const parts = text.split(/\s+/g).filter(Boolean);
  if (parts.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  const pushLine = () => {
    if (current !== '') lines.push(current);
    current = '';
  };

  for (const part of parts) {
    if (part.length > maxWidth) {
      if (current) pushLine();
      let i = 0;
      while (i < part.length) {
        lines.push(part.slice(i, i + maxWidth));
        i += maxWidth;
      }
      continue;
    }

    if (!current) {
      current = part;
    } else if ((current + ' ' + part).length <= maxWidth) {
      current += ' ' + part;
    } else {
      pushLine();
      current = part;
    }
  }

  pushLine();
  return lines.length > 0 ? lines : [''];
}

function computeTableColumnWidths(rows: string[][], maxWidth: number): number[] {
  const columnCount = Math.max(...rows.map(row => row.length));
  const widths = new Array<number>(columnCount).fill(1);

  for (const row of rows) {
    for (let col = 0; col < columnCount; col++) {
      const cell = row[col] ?? '';
      widths[col] = Math.max(widths[col]!, cell.length);
    }
  }

  const availableContentWidth = Math.max(1, maxWidth - (columnCount * 2) - (columnCount - 1));
  let total = widths.reduce((sum, w) => sum + w, 0);

  if (availableContentWidth <= columnCount) {
    return new Array<number>(columnCount).fill(1);
  }

  while (total > availableContentWidth) {
    let maxIndex = 0;
    for (let i = 1; i < widths.length; i++) {
      if ((widths[i] ?? 1) > (widths[maxIndex] ?? 1)) {
        maxIndex = i;
      }
    }
    if ((widths[maxIndex] ?? 1) <= 1) break;
    widths[maxIndex] = (widths[maxIndex] ?? 1) - 1;
    total -= 1;
  }

  return widths;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function reflowParagraphs(text: string): string {
  const rawLines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;

    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (line.trim() === '') {
      result.push(line);
      continue;
    }

    if (/^#{1,6}\s/.test(line) || /^[-*+]\s/.test(line) || /^\d+\.\s/.test(line) || isTableSeparator(line) || line.includes('|')) {
      result.push(line);
      continue;
    }

    const prev = result.length > 0 ? result[result.length - 1]! : '';
    const prevIsText = prev.trim() !== '' &&
      !/^```/.test(prev) &&
      !/^#{1,6}\s/.test(prev) &&
      !/^[-*+]\s/.test(prev) &&
      !/^\d+\.\s/.test(prev);

    if (prevIsText) {
      result[result.length - 1] = prev + ' ' + line;
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

export function parseAndWrapMarkdown(text: string, maxWidth: number): WrappedMarkdownBlock[] {
  const lines = reflowParagraphs(text).split('\n');
  const blocks: WrappedMarkdownBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let language: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        language = fenceMatch[1];
        codeLines = [];
      } else {
        const wrapped = codeLines.flatMap(codeLine => wrapCodeLine(codeLine, maxWidth));
        blocks.push({ type: 'code', codeLines: wrapped, language });
        inCodeBlock = false;
        codeLines = [];
        language = undefined;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const nextLine = lines[i + 1];
    if (line.includes('|') && typeof nextLine === 'string' && isTableSeparator(nextLine)) {
      const tableRows: string[][] = [];
      const splitRow = (rowLine: string) => {
        let row = rowLine.trim();
        if (row.startsWith('|')) row = row.slice(1);
        if (row.endsWith('|')) row = row.slice(0, -1);
        return row.split('|').map(cell => cell.trim());
      };

      tableRows.push(splitRow(line));
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i]!;
        if (!rowLine.includes('|') || rowLine.trim() === '') {
          i -= 1;
          break;
        }
        tableRows.push(splitRow(rowLine));
        i += 1;
      }

      const columnWidths = computeTableColumnWidths(tableRows, maxWidth);
      const tableCellLines = tableRows.map(row =>
        columnWidths.map((width, col) => wrapCellText(row[col] ?? '', width))
      );

      blocks.push({ type: 'table', tableRows, columnWidths, tableCellLines });
      continue;
    }

    blocks.push({
      type: 'line',
      wrappedLines: wrapMarkdownText(line, maxWidth)
    });
  }

  if (inCodeBlock) {
    const wrapped = codeLines.flatMap(codeLine => wrapCodeLine(codeLine, maxWidth));
    blocks.push({ type: 'code', codeLines: wrapped, language });
  }

  return blocks;
}
