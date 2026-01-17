export const wrapText = (text: string, maxWidth: number): string[] => {
  if (!text) return [''];
  if (maxWidth <= 0) return [text];
  if (text.length <= maxWidth) return [text];

  const lines: string[] = [];
  let currentLine = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === ' ' && currentLine.length === maxWidth) {
      lines.push(currentLine);
      currentLine = '';
      i++;
      continue;
    }

    if (currentLine.length + 1 > maxWidth) {
      const lastSpaceIndex = currentLine.lastIndexOf(' ');
      if (lastSpaceIndex > 0) {
        lines.push(currentLine.slice(0, lastSpaceIndex));
        currentLine = currentLine.slice(lastSpaceIndex + 1) + char;
      } else {
        lines.push(currentLine);
        currentLine = char || '';
      }
    } else {
      currentLine += char;
    }

    i++;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
};