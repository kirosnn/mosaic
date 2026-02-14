import { debugLog } from '../../utils/debug';

const CHATML_MARKERS = /<\|(?:im_start|im_end|endoftext|system|user|assistant|tool)\|>/;
const CHATML_TAG_GLOBAL = /<\|(?:im_start|im_end|endoftext|system|user|assistant|tool)\|>/g;

const CORRUPTION_DELTA_PATTERNS = [
  /assistant\s+to=functions\b/,
  CHATML_MARKERS,
  /\{\s*"(?:explanation|plan|step|status)":/,
  /^[#+=]{6,}$/,
  /(?:#\+){3,}/,
  /to=functions\.\w+/,
];

const HIGH_DENSITY_UNICODE = /[\u0600-\u06FF\u0530-\u058F\u4E00-\u9FFF\uFF00-\uFFEF]{4,}/;

export function sanitizeDelta(delta: string): string | null {
  if (typeof delta !== 'string' || !delta) return null;
  for (const pattern of CORRUPTION_DELTA_PATTERNS) {
    if (pattern.test(delta)) {
      debugLog(`[sanitizer] blocked corrupted delta: ${delta.slice(0, 80)}`);
      return null;
    }
  }
  if (HIGH_DENSITY_UNICODE.test(delta)) {
    const cleaned = delta.replace(HIGH_DENSITY_UNICODE, '');
    if (!cleaned.trim()) {
      debugLog(`[sanitizer] blocked internal-token delta: ${delta.slice(0, 80)}`);
      return null;
    }
    return cleaned;
  }
  return delta;
}

const CORRUPTION_TAILS = [
  /(?:#\+){2,}[^]*$/,
  /assistant\s+to=functions[^]*$/,
  /to=functions\.\w+[^]*$/,
  /<\|(?:im_start|im_end|endoftext|system|user|assistant|tool)\|>[^]*$/,
  /\{\s*"(?:explanation|plan|step|status)":[^]*$/,
];

export class StreamSanitizer {
  private buffer = '';
  private corrupted = false;
  private emittedLength = 0;
  private truncated = false;
  private droppedDeltas = 0;
  private consecutiveDroppedDeltas = 0;

  feed(delta: string): string | null {
    if (this.corrupted) return null;

    const safeDelta = sanitizeDelta(delta);
    if (safeDelta === null) {
      this.droppedDeltas++;
      this.consecutiveDroppedDeltas++;
      if (this.consecutiveDroppedDeltas >= 8) {
        this.corrupted = true;
        this.truncated = true;
        debugLog(`[sanitizer] stream marked corrupted after ${this.consecutiveDroppedDeltas} dropped deltas at offset ${this.emittedLength}`);
      }
      return null;
    }

    this.consecutiveDroppedDeltas = 0;
    this.buffer += safeDelta;

    for (const pattern of CORRUPTION_TAILS) {
      const match = pattern.exec(this.buffer);
      if (match) {
        const corruptionStart = match.index;
        if (corruptionStart <= this.emittedLength) {
          this.corrupted = true;
          this.truncated = true;
          debugLog(`[sanitizer] tail corruption detected at offset ${corruptionStart}, stream truncated`);
          return null;
        }
        const safeText = this.buffer.slice(this.emittedLength, corruptionStart);
        this.corrupted = true;
        this.truncated = true;
        debugLog(`[sanitizer] tail corruption detected, emitting safe prefix (${safeText.length} chars)`);
        return safeText || null;
      }
    }

    const newText = this.buffer.slice(this.emittedLength);
    this.emittedLength = this.buffer.length;
    return newText || null;
  }

  wasTruncated(): boolean {
    return this.truncated;
  }

  reset(): void {
    this.buffer = '';
    this.corrupted = false;
    this.emittedLength = 0;
    this.truncated = false;
    this.droppedDeltas = 0;
    this.consecutiveDroppedDeltas = 0;
  }
}

const LEAKED_CALL_BLOCK = /(?:#\+){2,}[^]*?(?:assistant\s+to=functions[^]*?(?:\n\n|$))/g;
const LEAKED_CALL_SIMPLE = /assistant\s+to=functions\.\w+[^]*?(?:\n\n|$)/g;
const TO_FUNCTIONS_BLOCK = /to=functions\.\w+\s+\w+\s*\{[^]*?\}\s*/g;
const STRAY_JSON_PLAN = /\{\s*"(?:explanation|plan|step|status)":[^]*?\}\s*$/;
const HIGH_DENSITY_UNICODE_LINE = /^[^\x00-\x7F]{6,}$/gm;
const REPEATED_SEPARATORS = /(?:#\+){3,}[#+=]*/g;

export function sanitizeAccumulatedText(text: string): string {
  if (typeof text !== 'string') return '';
  let cleaned = text;
  cleaned = cleaned.replace(LEAKED_CALL_BLOCK, '');
  cleaned = cleaned.replace(LEAKED_CALL_SIMPLE, '');
  cleaned = cleaned.replace(TO_FUNCTIONS_BLOCK, '');
  cleaned = cleaned.replace(CHATML_TAG_GLOBAL, '');
  cleaned = cleaned.replace(STRAY_JSON_PLAN, '');
  cleaned = cleaned.replace(HIGH_DENSITY_UNICODE_LINE, '');
  cleaned = cleaned.replace(REPEATED_SEPARATORS, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  if (cleaned !== text) {
    debugLog(`[sanitizer] cleaned accumulated text (removed ${text.length - cleaned.length} chars)`);
  }
  return cleaned.trim();
}
