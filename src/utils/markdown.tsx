import { TextAttributes } from "@opentui/core";

export interface MarkdownSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'codeblock' | 'codeblock-content' | 'heading' | 'listitem';
  content: string;
  level?: number;
}

export function parseMarkdownLine(line: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];

  if (line.startsWith('```')) {
    return [{ type: 'codeblock', content: line.replace(/^```/, '') }];
  }

  if (line.match(/^#{1,6}\s/)) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[2]) {
      return [{ type: 'heading', content: match[2], level: match[1]?.length || 1 }];
    }
  }

  if (line.match(/^[-*+]\s/)) {
    return [{ type: 'listitem', content: line.replace(/^[-*+]\s+/, '') }];
  }

  let i = 0;
  let text = '';

  while (i < line.length) {
    if (line.substring(i, i + 1) === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== '`') {
        j++;
      }

      if (j < line.length) {
        if (text) {
          segments.push({ type: 'text', content: text });
          text = '';
        }
        segments.push({ type: 'code', content: line.substring(i + 1, j) });
        i = j + 1;
        continue;
      }
    }

    if (line.substring(i, i + 2) === '**') {
      let j = i + 2;
      while (j < line.length - 1 && line.substring(j, j + 2) !== '**') {
        j++;
      }

      if (j < line.length - 1 && line.substring(j, j + 2) === '**') {
        if (text) {
          segments.push({ type: 'text', content: text });
          text = '';
        }
        segments.push({ type: 'bold', content: line.substring(i + 2, j) });
        i = j + 2;
        continue;
      }
    }

    if (line.substring(i, i + 1) === '*' && line.substring(i, i + 2) !== '**') {
      let j = i + 1;
      while (j < line.length && line[j] !== '*') {
        j++;
      }

      if (j < line.length && line[j] === '*') {
        if (text) {
          segments.push({ type: 'text', content: text });
          text = '';
        }
        segments.push({ type: 'italic', content: line.substring(i + 1, j) });
        i = j + 1;
        continue;
      }
    }

    text += line[i];
    i++;
  }

  if (text) {
    segments.push({ type: 'text', content: text });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: line }];
}

export function renderMarkdownSegment(segment: MarkdownSegment, key: number) {
  switch (segment.type) {
    case 'bold':
      return <text key={key} fg="white" attributes={TextAttributes.BOLD}>{segment.content}</text>;

    case 'italic':
      return <text key={key} fg="white" attributes={TextAttributes.DIM}>{segment.content}</text>;

    case 'code':
      return (
        <box key={key} backgroundColor="#2a2a2a" paddingLeft={1} paddingRight={1}>
          <text fg="white">{segment.content}</text>
        </box>
      );

    case 'codeblock':
      return <text key={key} fg="#888888" attributes={TextAttributes.DIM}>{segment.content}</text>;

    case 'codeblock-content':
      return <text key={key} fg="#e0e0e0">{segment.content}</text>;

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
  isCodeBlock: boolean;
  segments: MarkdownSegment[];
  rawLine: string;
}

export function parseMarkdownContent(content: string): ParsedMarkdownLine[] {
  const lines = content.split('\n');
  const result: ParsedMarkdownLine[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push({
        isCodeBlock: true,
        segments: [{ type: 'codeblock', content: line.replace(/^```/, '') }],
        rawLine: line
      });
      continue;
    }

    if (inCodeBlock) {
      result.push({
        isCodeBlock: true,
        segments: [{ type: 'codeblock-content', content: line }],
        rawLine: line
      });
    } else {
      result.push({
        isCodeBlock: false,
        segments: parseMarkdownLine(line),
        rawLine: line
      });
    }
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
    const prefix = segment.type === 'bold' ? '**' : segment.type === 'italic' ? '*' : segment.type === 'code' ? '`' : '';
    const suffix = prefix;
    const fullText = prefix + content + suffix;

    if (!currentLine) {
      if (fullText.length <= maxWidth) {
        currentLine = fullText;
        currentSegments.push(segment);
      } else {
        const words = content.split(' ');
        let tempContent = '';

        for (const word of words) {
          const testText = tempContent ? tempContent + ' ' + word : word;
          const testFullText = prefix + testText + suffix;

          if (testFullText.length <= maxWidth) {
            tempContent = testText;
          } else {
            if (tempContent) {
              currentLine = prefix + tempContent + suffix;
              currentSegments.push({ ...segment, content: tempContent });
              lines.push({ text: currentLine, segments: currentSegments });
              currentLine = '';
              currentSegments = [];
            }
            tempContent = word;
          }
        }

        if (tempContent) {
          currentLine = prefix + tempContent + suffix;
          currentSegments.push({ ...segment, content: tempContent });
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
          const words = content.split(' ');
          let tempContent = '';

          for (const word of words) {
            const testText = tempContent ? tempContent + ' ' + word : word;
            const testFullText = prefix + testText + suffix;

            if (testFullText.length <= maxWidth) {
              tempContent = testText;
            } else {
              if (tempContent) {
                currentLine = prefix + tempContent + suffix;
                currentSegments = [{ ...segment, content: tempContent }];
                lines.push({ text: currentLine, segments: currentSegments });
                currentLine = '';
                currentSegments = [];
              }
              tempContent = word;
            }
          }

          if (tempContent) {
            currentLine = prefix + tempContent + suffix;
            currentSegments = [{ ...segment, content: tempContent }];
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
