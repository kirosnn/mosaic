interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: number;
}

export class McpRateLimiter {
  private buckets = new Map<string, TokenBucket>();

  configure(serverId: string, maxCallsPerMinute: number): void {
    this.buckets.set(serverId, {
      tokens: maxCallsPerMinute,
      maxTokens: maxCallsPerMinute,
      refillRate: maxCallsPerMinute / 60,
      lastRefill: Date.now(),
    });
  }

  tryAcquire(serverId: string): boolean {
    const bucket = this.buckets.get(serverId);
    if (!bucket) return true;

    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  async acquire(serverId: string): Promise<void> {
    while (!this.tryAcquire(serverId)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  remove(serverId: string): void {
    this.buckets.delete(serverId);
  }

  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
  }
}