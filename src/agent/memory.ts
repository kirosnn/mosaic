export interface FileEntry {
  path: string;
  contentHash: string;
  summary: string;
  lineCount: number;
  firstReadAt: number;
  lastReadAt: number;
  readCount: number;
}

export interface SearchEntry {
  query: string;
  pattern: string;
  path: string;
  filesFound: number;
  matchCount: number;
  timestamp: number;
}

export interface ToolCallEntry {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  resultPreview: string;
  success: boolean;
  timestamp: number;
  turn: number;
}

const MAX_FILES = 200;
const MAX_SEARCHES = 100;
const MAX_TOOL_CALLS = 500;

const GLOBAL_KEY = '__mosaic_conversation_memory__';
const g = globalThis as any;

export function getGlobalMemory(): ConversationMemory {
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new ConversationMemory();
  }
  return g[GLOBAL_KEY];
}

export function resetGlobalMemory(): void {
  g[GLOBAL_KEY] = new ConversationMemory();
}

export class ConversationMemory {
  private files: Map<string, FileEntry> = new Map();
  private searches: SearchEntry[] = [];
  private toolCalls: ToolCallEntry[] = [];
  private turn = 0;
  private toolCallCounter = 0;

  recordFileRead(path: string, content: string): void {
    const lineCount = content.split('\n').length;
    const contentHash = `${content.length}:${content.slice(0, 64)}`;
    const summary = `${lineCount} lines`;
    const now = Date.now();

    const existing = this.files.get(path);
    if (existing) {
      existing.contentHash = contentHash;
      existing.summary = summary;
      existing.lineCount = lineCount;
      existing.lastReadAt = now;
      existing.readCount++;
    } else {
      this.files.set(path, {
        path,
        contentHash,
        summary,
        lineCount,
        firstReadAt: now,
        lastReadAt: now,
        readCount: 1,
      });
      this.evictFilesLRU();
    }
  }

  recordSearch(query: string, pattern: string, path: string, filesFound: number, matchCount: number): void {
    this.searches.push({
      query,
      pattern,
      path,
      filesFound,
      matchCount,
      timestamp: Date.now(),
    });
    if (this.searches.length > MAX_SEARCHES) {
      this.searches = this.searches.slice(-MAX_SEARCHES);
    }
  }

  recordToolCall(tool: string, args: Record<string, unknown>, resultPreview: string, success: boolean): void {
    this.toolCalls.push({
      id: ++this.toolCallCounter,
      tool,
      args,
      resultPreview,
      success,
      timestamp: Date.now(),
      turn: this.turn,
    });
    if (this.toolCalls.length > MAX_TOOL_CALLS) {
      this.toolCalls = this.toolCalls.slice(-MAX_TOOL_CALLS);
    }
  }

  getFileEntry(path: string): FileEntry | undefined {
    return this.files.get(path);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  getRecentToolCalls(n: number): ToolCallEntry[] {
    return this.toolCalls.slice(-n);
  }

  getKnownFilePaths(): string[] {
    return [...this.files.keys()];
  }

  buildMemoryContext(maxChars: number = 4000): string {
    const parts: string[] = [];

    if (this.files.size > 0) {
      const fileLines: string[] = [];
      const sorted = [...this.files.values()].sort((a, b) => b.lastReadAt - a.lastReadAt);
      const limit = Math.min(sorted.length, 50);
      for (let i = 0; i < limit; i++) {
        const f = sorted[i]!;
        fileLines.push(`  ${f.path} (${f.summary}, read ${f.readCount}x)`);
      }
      if (sorted.length > limit) {
        fileLines.push(`  ... +${sorted.length - limit} more files`);
      }
      parts.push(`KNOWN FILES (${this.files.size}):\n${fileLines.join('\n')}`);
    }

    if (this.searches.length > 0) {
      const searchLines: string[] = [];
      const recent = this.searches.slice(-20);
      for (const s of recent) {
        const scope = s.path && s.path !== '.' ? ` in ${s.path}` : '';
        searchLines.push(`  "${s.query}" ${s.pattern}${scope} -> ${s.matchCount} matches, ${s.filesFound} files`);
      }
      parts.push(`RECENT SEARCHES (${this.searches.length} total):\n${searchLines.join('\n')}`);
    }

    let result = parts.join('\n\n');
    if (result.length > maxChars) {
      result = result.slice(0, maxChars - 3) + '...';
    }
    return result;
  }

  getStats(): { files: number; searches: number; toolCalls: number; turn: number } {
    return {
      files: this.files.size,
      searches: this.searches.length,
      toolCalls: this.toolCalls.length,
      turn: this.turn,
    };
  }

  incrementTurn(): void {
    this.turn++;
  }

  clear(): void {
    this.files.clear();
    this.searches = [];
    this.toolCalls = [];
    this.turn = 0;
    this.toolCallCounter = 0;
  }

  private evictFilesLRU(): void {
    if (this.files.size <= MAX_FILES) return;
    const sorted = [...this.files.entries()].sort((a, b) => a[1].lastReadAt - b[1].lastReadAt);
    const toRemove = sorted.slice(0, this.files.size - MAX_FILES);
    for (const [key] of toRemove) {
      this.files.delete(key);
    }
  }
}
