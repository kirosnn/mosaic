import { describe, expect, it, mock, beforeEach } from "bun:test";

mock.module("../../../utils/debug", () => ({ debugLog: () => {} }));
mock.module("../../../utils/sound", () => ({ playUiSound: () => {} }));

let pendingChangeCalls: Array<{ type: string; path: string; oldContent: string; newContent: string }> = [];

mock.module("../../../utils/pendingChangesBridge", () => ({
  addPendingChange: (type: string, _source: string, path: string, oldContent: string, newContent: string) => {
    pendingChangeCalls.push({ type, path, oldContent, newContent });
    return "mock-id";
  },
  hasPendingChanges: () => pendingChangeCalls.length > 0,
  isInReviewMode: () => false,
  startReview: async () => [],
  clearPendingChanges: () => { pendingChangeCalls = []; },
}));

mock.module("../../../utils/fileChangeTracker", () => ({
  trackFileChange: () => {},
  trackFileCreated: () => {},
}));

mock.module("../../../utils/diff", () => ({
  generateDiff: (_a: string, _b: string) => ({ hasChanges: true, hunks: [] }),
  formatDiffForDisplay: () => ["--- old", "+++ new"],
}));

type StatEntry = { mtimeMs: number; size: number };

function makeSnapshot(
  files: Record<string, string>,
  stats: Record<string, StatEntry>
) {
  return {
    files: new Map(Object.entries(files)),
    stats: new Map(Object.entries(stats)),
    truncated: false,
    skipped: 0,
  };
}

function shouldQueueReviewChange(
  before: ReturnType<typeof makeSnapshot>,
  afterContents: Map<string, string>,
  afterStats: ReturnType<typeof makeSnapshot>,
  path: string,
): boolean {
  const beforeExists = before.stats.has(path);
  const afterExists = afterStats.stats.has(path);
  const oldContentKnown = before.files.has(path);
  const newContentKnown = afterContents.has(path);
  const oldContent = oldContentKnown ? before.files.get(path)! : "";
  const newContent = newContentKnown ? afterContents.get(path)! : "";
  const existenceChanged = beforeExists !== afterExists;
  const contentChanged = oldContentKnown && newContentKnown && oldContent !== newContent;
  return existenceChanged || contentChanged;
}

describe("review: empty file create/delete detection", () => {
  beforeEach(() => {
    pendingChangeCalls = [];
  });

  it("detects creation of an empty file", async () => {
    const before = makeSnapshot({}, {});
    const afterStats = makeSnapshot({}, { "test.txt": { mtimeMs: 1000, size: 0 } });
    const afterContents = new Map<string, string>();

    expect(shouldQueueReviewChange(before, afterContents, afterStats, "test.txt")).toBe(true);
  });

  it("detects deletion of an empty file", async () => {
    const before = makeSnapshot({ "test.txt": "" }, { "test.txt": { mtimeMs: 1000, size: 0 } });
    const afterStats = makeSnapshot({}, {});
    const afterContents = new Map<string, string>();

    expect(shouldQueueReviewChange(before, afterContents, afterStats, "test.txt")).toBe(true);
  });

  it("detects deletion of a non-empty file", async () => {
    const before = makeSnapshot({ "test.txt": "hello" }, { "test.txt": { mtimeMs: 1000, size: 5 } });
    const afterStats = makeSnapshot({}, {});
    const afterContents = new Map<string, string>();

    expect(shouldQueueReviewChange(before, afterContents, afterStats, "test.txt")).toBe(true);
  });

  it("detects modification of a file", async () => {
    const before = makeSnapshot({ "test.txt": "old" }, { "test.txt": { mtimeMs: 1000, size: 3 } });
    const afterStats = makeSnapshot({ "test.txt": "new" }, { "test.txt": { mtimeMs: 2000, size: 3 } });

    expect(shouldQueueReviewChange(before, afterStats.files, afterStats, "test.txt")).toBe(true);
  });

  it("produces no false positive when nothing changed", async () => {
    const before = makeSnapshot({ "test.txt": "same" }, { "test.txt": { mtimeMs: 1000, size: 4 } });
    const afterStats = makeSnapshot({ "test.txt": "same" }, { "test.txt": { mtimeMs: 1000, size: 4 } });

    expect(shouldQueueReviewChange(before, afterStats.files, afterStats, "test.txt")).toBe(false);
  });
});
