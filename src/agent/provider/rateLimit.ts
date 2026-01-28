export type RetryDecision = {
  shouldRetry: boolean;
  retryAfterMs?: number;
};

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  abortSignal?: AbortSignal;
};

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 4,
  baseDelayMs: 800,
  maxDelayMs: 12000,
  jitterMs: 250,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(toErrorMessage(error));
}

function getStatus(error: unknown): number | undefined {
  const e: any = error as any;
  const direct = e?.status ?? e?.statusCode ?? e?.code;
  if (typeof direct === 'number') return direct;
  const nested = e?.response?.status ?? e?.response?.statusCode;
  if (typeof nested === 'number') return nested;
  const inner = e?.error?.status ?? e?.error?.statusCode;
  if (typeof inner === 'number') return inner;
  return undefined;
}

export function getErrorSignature(error: unknown): string {
  const status = getStatus(error);
  const code = (error as any)?.code;
  const message = toErrorMessage(error);
  return `${status ?? ''}|${code ?? ''}|${message}`;
}

function getHeader(error: unknown, name: string): string | undefined {
  const e: any = error as any;
  const headers = e?.response?.headers ?? e?.headers ?? e?.responseHeaders;
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    const value = headers.get(name) ?? headers.get(lower);
    return value ? String(value) : undefined;
  }
  if (typeof headers === 'object') {
    const value = headers[name] ?? headers[lower];
    return value ? String(value) : undefined;
  }
  return undefined;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function isRetryableMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('rate limit')) return true;
  if (m.includes('too many requests')) return true;
  if (m.includes('quota')) return true;
  if (m.includes('throttle')) return true;
  if (m.includes('429')) return true;
  if (m.includes('timeout')) return true;
  if (m.includes('timed out')) return true;
  if (m.includes('econnreset')) return true;
  if (m.includes('econnrefused')) return true;
  if (m.includes('etimedout')) return true;
  if (m.includes('enotfound')) return true;
  if (m.includes('fetch failed')) return true;
  if (m.includes('socket hang up')) return true;
  return false;
}

export function getRetryDecision(error: unknown): RetryDecision {
  const status = getStatus(error);
  if (status === 429) {
    return { shouldRetry: true, retryAfterMs: parseRetryAfter(getHeader(error, 'retry-after')) };
  }
  if (status === 408 || (status !== undefined && status >= 500 && status < 600)) {
    return { shouldRetry: true };
  }
  const message = toErrorMessage(error);
  if (isRetryableMessage(message)) {
    return { shouldRetry: true, retryAfterMs: parseRetryAfter(getHeader(error, 'retry-after')) };
  }
  return { shouldRetry: false };
}

function computeDelayMs(attempt: number, options: RetryOptions, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(options.maxDelayMs, retryAfterMs);
  }
  const jitter = Math.floor(Math.random() * options.jitterMs);
  const backoff = options.baseDelayMs * Math.pow(2, attempt);
  return Math.min(options.maxDelayMs, backoff + jitter);
}

async function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (abortSignal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function* runWithRetry<T>(
  run: () => AsyncGenerator<T>,
  options: Partial<RetryOptions> = {}
): AsyncGenerator<T> {
  const config: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  let attempt = 0;
  let lastSignature: string | null = null;
  let sameSignatureCount = 0;

  while (true) {
    if (config.abortSignal?.aborted) return;
    try {
      yield* run();
      return;
    } catch (error) {
      if (config.abortSignal?.aborted) return;
      const decision = getRetryDecision(error);
      const signature = getErrorSignature(error);
      if (signature === lastSignature) {
        sameSignatureCount += 1;
      } else {
        lastSignature = signature;
        sameSignatureCount = 0;
      }
      if (!decision.shouldRetry || attempt >= config.maxRetries) {
        throw error;
      }
      if (sameSignatureCount >= 1) {
        throw error;
      }
      const delay = computeDelayMs(attempt, config, decision.retryAfterMs);
      await sleep(delay, config.abortSignal);
      attempt += 1;
    }
  }
}
