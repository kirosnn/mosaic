import { debugLog } from '../../utils/debug';

export type RetryDecision = {
  shouldRetry: boolean;
  retryAfterMs?: number;
};

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryAfterMs: number;
  jitterMs: number;
  key: string;
  maxConcurrency: number;
  abortSignal?: AbortSignal;
};

export type RateLimitConfig = {
  requestsPerMinute: number;
  requestsPerSecond?: number;
  burstLimit?: number;
  cooldownMultiplier?: number;
};

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 15,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  maxRetryAfterMs: 300000,
  jitterMs: 500,
  key: 'global',
  maxConcurrency: 1,
};

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerSecond: 5,
  burstLimit: 10,
  cooldownMultiplier: 1.5,
};

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

interface SlidingWindow {
  timestamps: number[];
  windowMs: number;
  maxRequests: number;
}

interface GlobalRateLimiter {
  bucket: TokenBucket;
  slidingWindow: SlidingWindow;
  config: RateLimitConfig;
  cooldownUntil: number;
  consecutive429: number;
}

const globalRateLimiters = new Map<string, GlobalRateLimiter>();

function getGlobalRateLimiter(key: string, config?: Partial<RateLimitConfig>): GlobalRateLimiter {
  const existing = globalRateLimiters.get(key);
  if (existing) return existing;

  const finalConfig = { ...DEFAULT_RATE_LIMIT, ...config };
  const limiter: GlobalRateLimiter = {
    bucket: {
      tokens: finalConfig.burstLimit || 10,
      lastRefill: Date.now(),
      maxTokens: finalConfig.burstLimit || 10,
      refillRate: (finalConfig.requestsPerSecond || 5) / 1000,
    },
    slidingWindow: {
      timestamps: [],
      windowMs: 60000,
      maxRequests: finalConfig.requestsPerMinute,
    },
    config: finalConfig,
    cooldownUntil: 0,
    consecutive429: 0,
  };
  globalRateLimiters.set(key, limiter);
  return limiter;
}

function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = elapsed * bucket.refillRate;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}

function cleanSlidingWindow(window: SlidingWindow): void {
  const cutoff = Date.now() - window.windowMs;
  window.timestamps = window.timestamps.filter(ts => ts > cutoff);
}

function canMakeRequest(limiter: GlobalRateLimiter): { allowed: boolean; waitMs: number } {
  const now = Date.now();

  if (limiter.cooldownUntil > now) {
    return { allowed: false, waitMs: limiter.cooldownUntil - now };
  }

  refillBucket(limiter.bucket);
  cleanSlidingWindow(limiter.slidingWindow);

  if (limiter.bucket.tokens < 1) {
    const waitMs = Math.ceil((1 - limiter.bucket.tokens) / limiter.bucket.refillRate);
    return { allowed: false, waitMs };
  }

  if (limiter.slidingWindow.timestamps.length >= limiter.slidingWindow.maxRequests) {
    const oldestTimestamp = limiter.slidingWindow.timestamps[0] ?? now;
    const waitMs = oldestTimestamp + limiter.slidingWindow.windowMs - now;
    return { allowed: false, waitMs: Math.max(0, waitMs) };
  }

  return { allowed: true, waitMs: 0 };
}

function consumeToken(limiter: GlobalRateLimiter): void {
  limiter.bucket.tokens -= 1;
  limiter.slidingWindow.timestamps.push(Date.now());
}

function applyCooldown(limiter: GlobalRateLimiter, baseDelayMs: number): void {
  limiter.consecutive429 += 1;
  const multiplier = Math.pow(limiter.config.cooldownMultiplier || 1.5, limiter.consecutive429);
  const cooldownMs = Math.min(300000, baseDelayMs * multiplier);
  limiter.cooldownUntil = Date.now() + cooldownMs;
  debugLog(`[rate-limit] global cooldown applied | key=${Array.from(globalRateLimiters.entries()).find(([_, v]) => v === limiter)?.[0]} | cooldownMs=${cooldownMs} | consecutive429=${limiter.consecutive429}`);
}

function resetCooldown(limiter: GlobalRateLimiter): void {
  limiter.consecutive429 = 0;
  limiter.cooldownUntil = 0;
}

export async function waitForRateLimit(
  key: string = 'global',
  config?: Partial<RateLimitConfig>,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const limiter = getGlobalRateLimiter(key, config);

  while (true) {
    if (abortSignal?.aborted) return false;

    const { allowed, waitMs } = canMakeRequest(limiter);
    if (allowed) {
      consumeToken(limiter);
      return true;
    }

    debugLog(`[rate-limit] waiting ${waitMs}ms before next request | key=${key}`);
    await sleep(Math.min(waitMs, 1000), abortSignal);
  }
}

export function reportRateLimitSuccess(key: string = 'global'): void {
  const limiter = globalRateLimiters.get(key);
  if (limiter) {
    resetCooldown(limiter);
  }
}

export function reportRateLimitError(key: string = 'global', retryAfterMs?: number): void {
  const limiter = globalRateLimiters.get(key);
  if (limiter) {
    applyCooldown(limiter, retryAfterMs || 5000);
  }
}

export function getRateLimitStatus(key: string = 'global'): {
  tokensAvailable: number;
  requestsInWindow: number;
  cooldownRemainingMs: number;
  consecutive429: number;
} {
  const limiter = globalRateLimiters.get(key);
  if (!limiter) {
    return { tokensAvailable: 10, requestsInWindow: 0, cooldownRemainingMs: 0, consecutive429: 0 };
  }

  refillBucket(limiter.bucket);
  cleanSlidingWindow(limiter.slidingWindow);

  return {
    tokensAvailable: Math.floor(limiter.bucket.tokens),
    requestsInWindow: limiter.slidingWindow.timestamps.length,
    cooldownRemainingMs: Math.max(0, limiter.cooldownUntil - Date.now()),
    consecutive429: limiter.consecutive429,
  };
}

export function configureGlobalRateLimit(key: string, config: Partial<RateLimitConfig>): void {
  const existing = globalRateLimiters.get(key);
  if (existing) {
    existing.config = { ...existing.config, ...config };
    existing.bucket.maxTokens = config.burstLimit || existing.bucket.maxTokens;
    existing.bucket.refillRate = (config.requestsPerSecond || existing.config.requestsPerSecond || 5) / 1000;
    existing.slidingWindow.maxRequests = config.requestsPerMinute || existing.slidingWindow.maxRequests;
  } else {
    getGlobalRateLimiter(key, config);
  }
  debugLog(`[rate-limit] configured | key=${key} | config=${JSON.stringify(config)}`);
}

export type RateLimitedRetryOptions = {
  key?: string;
  rateLimitConfig?: Partial<RateLimitConfig>;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  abortSignal?: AbortSignal;
};

export async function runWithRateLimitedRetry<T>(
  run: () => Promise<T>,
  options: RateLimitedRetryOptions = {}
): Promise<T> {
  const {
    key = 'global',
    rateLimitConfig,
    maxRetries = 10,
    baseDelayMs = 1000,
    maxDelayMs = 60000,
    abortSignal,
  } = options;

  let attempt = 0;
  const startTime = Date.now();

  while (true) {
    if (abortSignal?.aborted) {
      throw new Error('Request aborted');
    }

    const canProceed = await waitForRateLimit(key, rateLimitConfig, abortSignal);
    if (!canProceed) {
      throw new Error('Rate limit wait aborted');
    }

    try {
      const result = await run();
      reportRateLimitSuccess(key);
      if (attempt > 0) {
        const elapsed = Date.now() - startTime;
        debugLog(`[rate-limit] recovered after ${attempt} retries (${elapsed}ms total)`);
      }
      return result;
    } catch (error) {
      if (abortSignal?.aborted) {
        throw error;
      }

      const decision = getRetryDecision(error);
      if (!decision.shouldRetry || attempt >= maxRetries) {
        const elapsed = Date.now() - startTime;
        const reason = !decision.shouldRetry ? 'not retryable' : `max retries (${maxRetries}) exhausted`;
        debugLog(`[rate-limit] giving up | ${reason} | attempt=${attempt}/${maxRetries} | elapsed=${elapsed}ms`);
        throw error;
      }

      reportRateLimitError(key, decision.retryAfterMs);

      const delay = computeDelayForAttempt(attempt, baseDelayMs, maxDelayMs, decision.retryAfterMs);
      const elapsed = Date.now() - startTime;
      debugLog(`[rate-limit] retry ${attempt + 1}/${maxRetries} | waiting ${delay}ms | elapsed=${elapsed}ms | key=${key}`);

      await sleep(delay, abortSignal);
      attempt += 1;
    }
  }
}

function computeDelayForAttempt(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  retryAfterMs?: number
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    const jitter = Math.floor(Math.random() * 500);
    return Math.min(300000, retryAfterMs) + jitter;
  }

  const cap = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const half = Math.floor(cap / 2);
  const jittered = half + Math.floor(Math.random() * (Math.max(1, cap - half) + 1));
  return Math.max(1, jittered);
}

type LimiterState = {
  active: number;
  queue: Array<() => void>;
};

const nextAllowedRequestAtByKey = new Map<string, number>();
const limitersByKey = new Map<string, LimiterState>();
const consecutive429ByKey = new Map<string, number>();

function getLimiter(key: string): LimiterState {
  const existing = limitersByKey.get(key);
  if (existing) return existing;
  const created: LimiterState = { active: 0, queue: [] };
  limitersByKey.set(key, created);
  return created;
}

function getNextAllowedRequestAt(key: string): number {
  return nextAllowedRequestAtByKey.get(key) ?? 0;
}

function setNextAllowedRequestAt(key: string, value: number): void {
  nextAllowedRequestAtByKey.set(key, value);
}

function bumpConsecutive429(key: string): number {
  const next = (consecutive429ByKey.get(key) ?? 0) + 1;
  consecutive429ByKey.set(key, next);
  return next;
}

function resetConsecutive429(key: string): void {
  consecutive429ByKey.set(key, 0);
}

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
  const durationMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h)$/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = (durationMatch[2] || 's').toLowerCase();
    if (!Number.isNaN(amount)) {
      const mult = unit === 'ms' ? 1 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 1000;
      return Math.max(0, Math.round(amount * mult));
    }
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function getRetryAfterMsFromRateLimitHeaders(error: unknown): number | undefined {
  const retryAfter = parseRetryAfter(getHeader(error, 'retry-after'));
  if (retryAfter !== undefined) return retryAfter;

  const resetRequests = parseRetryAfter(getHeader(error, 'x-ratelimit-reset-requests'));
  if (resetRequests !== undefined) return resetRequests;

  const resetTokens = parseRetryAfter(getHeader(error, 'x-ratelimit-reset-tokens'));
  if (resetTokens !== undefined) return resetTokens;

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
  const message = toErrorMessage(error);
  if (status === 429) {
    const retryAfterMs = getRetryAfterMsFromRateLimitHeaders(error);
    const retryAfterHeader = getHeader(error, 'retry-after');
    const resetRequests = getHeader(error, 'x-ratelimit-reset-requests');
    const resetTokens = getHeader(error, 'x-ratelimit-reset-tokens');
    const limitRequests = getHeader(error, 'x-ratelimit-limit-requests');
    const remainingRequests = getHeader(error, 'x-ratelimit-remaining-requests');
    const limitTokens = getHeader(error, 'x-ratelimit-limit-tokens');
    const remainingTokens = getHeader(error, 'x-ratelimit-remaining-tokens');
    debugLog(`[rate-limit] 429 hit | retry-after=${retryAfterHeader ?? 'none'} retryAfterMs=${retryAfterMs ?? 'none'} | requests=${remainingRequests ?? '?'}/${limitRequests ?? '?'} reset=${resetRequests ?? 'none'} | tokens=${remainingTokens ?? '?'}/${limitTokens ?? '?'} reset=${resetTokens ?? 'none'} | msg=${message.slice(0, 200)}`);
    return { shouldRetry: true, retryAfterMs };
  }
  if (status === 408 || (status !== undefined && status >= 500 && status < 600)) {
    debugLog(`[rate-limit] server error status=${status} | msg=${message.slice(0, 200)}`);
    return { shouldRetry: true };
  }
  if (isRetryableMessage(message)) {
    const retryAfterMs = getRetryAfterMsFromRateLimitHeaders(error);
    debugLog(`[rate-limit] retryable message match | retryAfterMs=${retryAfterMs ?? 'none'} | msg=${message.slice(0, 200)}`);
    return { shouldRetry: true, retryAfterMs };
  }
  return { shouldRetry: false };
}

function computeDelayMs(attempt: number, options: RetryOptions, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    const base = Math.min(options.maxRetryAfterMs, retryAfterMs);
    const jitter = Math.floor(Math.random() * Math.min(options.jitterMs, 1000));
    return base + jitter;
  }

  const cap = Math.min(options.maxDelayMs, options.baseDelayMs * Math.pow(2, attempt));
  const half = Math.floor(cap / 2);
  const jittered = half + Math.floor(Math.random() * (Math.max(1, cap - half) + 1));
  return Math.max(1, jittered);
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

async function waitForCooldown(key: string, abortSignal?: AbortSignal): Promise<void> {
  const cooldownWait = getNextAllowedRequestAt(key) - Date.now();
  if (cooldownWait > 0) {
    debugLog(`[rate-limit] cooldown active (key=${key}), waiting ${cooldownWait}ms before request`);
    await sleep(cooldownWait, abortSignal);
  }
}

function createReleaseFn(key: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const limiter = getLimiter(key);
    limiter.active = Math.max(0, limiter.active - 1);
    const next = limiter.queue.shift();
    if (next) next();
  };
}

async function acquireSlot(
  key: string,
  maxConcurrency: number,
  abortSignal?: AbortSignal
): Promise<(() => void) | null> {
  const limiter = getLimiter(key);
  const max = Math.max(1, maxConcurrency);

  if (limiter.active < max) {
    limiter.active += 1;
    return createReleaseFn(key);
  }

  return await new Promise<(() => void) | null>((resolve) => {
    const removeAbortListener = () => {
      if (!abortSignal) return;
      abortSignal.removeEventListener('abort', onAbort);
    };

    const waiter = () => {
      cleanup();
      removeAbortListener();
      limiter.active += 1;
      resolve(createReleaseFn(key));
    };

    const onAbort = () => {
      cleanup();
      removeAbortListener();
      resolve(null);
    };

    const cleanup = () => {
      const idx = limiter.queue.indexOf(waiter);
      if (idx >= 0) limiter.queue.splice(idx, 1);
    };

    limiter.queue.push(waiter);
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
  const key = config.key || 'global';
  let attempt = 0;
  const startTime = Date.now();
  let hasYielded = false;

  while (true) {
    if (config.abortSignal?.aborted) return;

    await waitForCooldown(key, config.abortSignal);
    if (config.abortSignal?.aborted) return;

    const release = await acquireSlot(key, config.maxConcurrency, config.abortSignal);
    if (!release) return;

    try {
      try {
        const gen = run();
        for await (const value of gen) {
          hasYielded = true;
          yield value;
        }
      } finally {
        release();
      }
      if (attempt > 0) {
        const elapsed = Date.now() - startTime;
        debugLog(`[rate-limit] recovered after ${attempt} retries (${elapsed}ms total)`);
      }
      setNextAllowedRequestAt(key, 0);
      resetConsecutive429(key);
      return;
    } catch (error) {
      if (config.abortSignal?.aborted) return;

      if (hasYielded) {
        const elapsed = Date.now() - startTime;
        debugLog(`[rate-limit] not retrying | events already emitted to consumer | elapsed=${elapsed}ms | error=${toErrorMessage(error).slice(0, 200)}`);
        throw error;
      }

      const decision = getRetryDecision(error);
      if (!decision.shouldRetry || attempt >= config.maxRetries) {
        const elapsed = Date.now() - startTime;
        const reason = !decision.shouldRetry ? 'not retryable' : `max retries (${config.maxRetries}) exhausted`;
        debugLog(`[rate-limit] giving up | ${reason} | attempt=${attempt}/${config.maxRetries} | elapsed=${elapsed}ms | error=${toErrorMessage(error).slice(0, 200)}`);
        throw error;
      }
      const status = getStatus(error);
      const consecutive429 = status === 429 ? bumpConsecutive429(key) : 0;
      let delay = computeDelayMs(attempt, config, decision.retryAfterMs);
      if (status === 429 && decision.retryAfterMs === undefined) {
        const streak = Math.min(10, Math.max(1, consecutive429));
        const minDelay = Math.min(300000, config.baseDelayMs * Math.pow(2, streak + 2));
        delay = Math.max(delay, minDelay);
      }
      setNextAllowedRequestAt(key, Date.now() + delay);
      const elapsed = Date.now() - startTime;
      debugLog(`[rate-limit] retry ${attempt + 1}/${config.maxRetries} | waiting ${delay}ms (backoff) | elapsed=${elapsed}ms | headerDelay=${decision.retryAfterMs ?? 'none'} | key=${key} | concurrency=${config.maxConcurrency} | consecutive429=${consecutive429}`);
      await sleep(delay, config.abortSignal);
      attempt += 1;
    }
  }
}