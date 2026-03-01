function isListLike(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('> ')) return true;
  return /^\d+\.\s/.test(trimmed);
}

function isCharWrapped(lines: string[]): boolean {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length < 4) return false;
  let shortCount = 0;
  for (const line of nonEmpty) {
    if (line.trim().length <= 2) shortCount++;
  }
  return shortCount / nonEmpty.length >= 0.7;
}

export function normalizeSelectedText(rawText: string): string {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.includes('\n')) return text;

  const lines = text.split('\n');
  const charWrapped = isCharWrapped(lines);
  const out: string[] = [];

  for (const line of lines) {
    const current = line;
    const prev = out.length > 0 ? out[out.length - 1] : undefined;

    if (prev === undefined) {
      out.push(current);
      continue;
    }

    if (prev === '' || current === '') {
      out.push(current);
      continue;
    }

    if (charWrapped) {
      out[out.length - 1] = prev + current;
      continue;
    }

    const prevTrimmedEnd = prev.trimEnd();
    const currentTrimmedStart = current.trimStart();

    if (isListLike(prev) || isListLike(current)) {
      out.push(current);
      continue;
    }

    if (/[.?!:;]$/.test(prevTrimmedEnd)) {
      out.push(current);
      continue;
    }

    if (/^[,.;:!?)\]}]/.test(currentTrimmedStart)) {
      out[out.length - 1] = prevTrimmedEnd + currentTrimmedStart;
      continue;
    }

    if (/[(/[\{'"`=+\-_*\\]$/.test(prevTrimmedEnd)) {
      out[out.length - 1] = prevTrimmedEnd + currentTrimmedStart;
      continue;
    }

    out[out.length - 1] = `${prevTrimmedEnd} ${currentTrimmedStart}`;
  }

  return out.join('\n').replace(/[ \t]+\n/g, '\n').trimEnd();
}
