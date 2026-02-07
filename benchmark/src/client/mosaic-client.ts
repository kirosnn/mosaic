import { CONFIG } from "../config.js";
import { RateLimitError } from "../types.js";
import type { ApprovalPolicy, CollectorResult } from "../types.js";
import { EventCollector } from "./event-collector.js";

export class MosaicClient {
  private get baseUrl() {
    return CONFIG.mosaicUrl;
  }

  async getConfig(): Promise<{ provider: string; model: string; requireApprovals: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/config`);
    if (!res.ok) throw new Error(`Mosaic config failed: ${res.status}`);
    return res.json() as Promise<{ provider: string; model: string; requireApprovals: boolean }>;
  }

  async setConfig(opts: { provider?: string; model?: string }): Promise<{ provider: string; model: string }> {
    const res = await fetch(`${this.baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Config set failed: ${res.status}`);
    return res.json() as Promise<{ provider: string; model: string }>;
  }

  async setWorkspace(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Workspace set failed: ${res.status}`);
  }

  async setApprovals(requireApprovals: boolean): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/approvals`, {
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
  ): Promise<CollectorResult> {
    const res = await fetch(`${this.baseUrl}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: [] }),
    });

    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new RateLimitError(body.error ?? "Rate limit: 429");
    }
    if (!res.ok) throw new Error(`Message failed: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const collector = new EventCollector();
    return collector.collect(res, approvalPolicy, timeout);
  }

  async stop(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/stop`, { method: "POST" });
    } catch {}
  }
}
