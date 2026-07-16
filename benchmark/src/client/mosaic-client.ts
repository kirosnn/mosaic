import { CONFIG } from "../config.js";
import { RateLimitError } from "../types.js";
import type { ApprovalPolicy, BenchmarkMessage, CollectorResult } from "../types.js";
import { EventCollector } from "./event-collector.js";

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const secs = Number(trimmed);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

export class MosaicClient {
  private get baseUrl() {
    return CONFIG.mosaicUrl;
  }

  private route(path: string): string {
    return `${this.baseUrl}${CONFIG.apiPrefix}${path}`;
  }

  async getConfig(): Promise<{ provider: string; model: string; requireApprovals: boolean }> {
    const res = await fetch(this.route(CONFIG.routes.config));
    if (!res.ok) throw new Error(`Mosaic config failed: ${res.status}`);
    return res.json() as Promise<{ provider: string; model: string; requireApprovals: boolean }>;
  }

  async setConfig(opts: { provider?: string; model?: string }): Promise<{ provider: string; model: string }> {
    const res = await fetch(this.route(CONFIG.routes.config), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Config set failed: ${res.status}`);
    return res.json() as Promise<{ provider: string; model: string }>;
  }

  async setWorkspace(path: string): Promise<void> {
    const res = await fetch(this.route(CONFIG.routes.workspace), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Workspace set failed: ${res.status}`);
  }

  async setApprovals(requireApprovals: boolean): Promise<void> {
    const res = await fetch(this.route(CONFIG.routes.approvals), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requireApprovals }),
    });
    if (!res.ok) throw new Error(`Approvals set failed: ${res.status}`);
  }

  async sendMessage(
    message: string,
    approvalPolicy: ApprovalPolicy = "auto",
    timeout: number = CONFIG.defaultTimeout,
    history: BenchmarkMessage[] = [],
  ): Promise<CollectorResult> {
    const res = await fetch(this.route(CONFIG.routes.message), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });

    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new RateLimitError(body.error ?? "Rate limit: 429", { retryAfterMs: parseRetryAfterMs(res) });
    }
    if (!res.ok) throw new Error(`Message failed: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const collector = new EventCollector();
    return collector.collect(res, approvalPolicy, timeout);
  }

  async stop(): Promise<void> {
    try {
      await fetch(this.route(CONFIG.routes.stop), { method: "POST" });
    } catch {}
  }
}
