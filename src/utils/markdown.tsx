import { TextAttributes } from "@opentui/core";

export interface MarkdownSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'heading' | 'listitem';
  content: string;
  level?: number;
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

  for (const segment of segments) {
    const content = segment.content;
    const fullText = content;

    if (!currentLine) {
      if (fullText.length <= maxWidth) {
        currentLine = fullText;
        currentSegments.push(segment);
      } else {
        let remaining = content;
        while (remaining) {
          if (remaining.length <= maxWidth) {
            currentLine = remaining;
            currentSegments.push({ ...segment, content: remaining });
            remaining = '';
          } else {
            const breakPoint = remaining.lastIndexOf(' ', maxWidth);
            if (breakPoint > 0) {
              const chunk = remaining.slice(0, breakPoint);
              currentLine = chunk;
              currentSegments.push({ ...segment, content: chunk });
              lines.push({ text: currentLine, segments: currentSegments });
              currentLine = '';
              currentSegments = [];
              remaining = remaining.slice(breakPoint + 1);
            } else {
              const chunk = remaining.slice(0, maxWidth);
              currentLine = chunk;
              currentSegments.push({ ...segment, content: chunk });
              lines.push({ text: currentLine, segments: currentSegments });
              currentLine = '';
              currentSegments = [];
              remaining = remaining.slice(maxWidth);
            }
          }
        }
      }
    } else {
      const needsSpace = !currentLine.endsWith(' ') && !fullText.startsWith(' ');
      const separator = needsSpace ? ' ' : '';

      if ((currentLine + separator + fullText).length <= maxWidth) {
        currentLine += separator + fullText;
        currentSegments.push(segment);
      } else {
        lines.push({ text: currentLine, segments: currentSegments });
        currentLine = fullText;
        currentSegments = [segment];

        if (fullText.length > maxWidth) {
          let remaining = content;
          while (remaining) {
            if (remaining.length <= maxWidth) {
              currentLine = remaining;
              currentSegments = [{ ...segment, content: remaining }];
              remaining = '';
            } else {
              const breakPoint = remaining.lastIndexOf(' ', maxWidth);
              if (breakPoint > 0) {
                const chunk = remaining.slice(0, breakPoint);
                currentLine = chunk;
                currentSegments = [{ ...segment, content: chunk }];
                lines.push({ text: currentLine, segments: currentSegments });
                currentLine = '';
                currentSegments = [];
                remaining = remaining.slice(breakPoint + 1);
              } else {
                const chunk = remaining.slice(0, maxWidth);
                currentLine = chunk;
                currentSegments = [{ ...segment, content: chunk }];
                lines.push({ text: currentLine, segments: currentSegments });
                currentLine = '';
                currentSegments = [];
                remaining = remaining.slice(maxWidth);
              }
            }
          }
        }
      }
    }
  }

  if (currentLine) {
    lines.push({ text: currentLine, segments: currentSegments });
  }

  return lines.length > 0 ? lines : [{ text: '', segments: [] }];
}

export interface WrappedMarkdownBlock {
  type: 'line' | 'code';
  wrappedLines?: { text: string; segments: MarkdownSegment[] }[];
  codeLines?: string[];
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

export function parseAndWrapMarkdown(text: string, maxWidth: number): WrappedMarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: WrappedMarkdownBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let language: string | undefined;

  for (const line of lines) {
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
