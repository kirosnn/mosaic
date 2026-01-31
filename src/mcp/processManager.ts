import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, McpServerState, McpToolInfo } from './types';
import { toCanonicalId, toSafeId } from './types';
import { McpRateLimiter } from './rateLimiter';

interface LogEntry {
  timestamp: number;
  level: 'info' | 'error' | 'debug';
  message: string;
}

interface ServerInstance {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  state: McpServerState;
  tools: McpToolInfo[];
  logBuffer: LogEntry[];
  restartCount: number;
  lastRestartAt: number;
}

const MAX_RESTART_COUNT = 5;
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

export class McpProcessManager {
  private servers = new Map<string, ServerInstance>();
  private rateLimiter = new McpRateLimiter();

  async startServer(config: McpServerConfig): Promise<McpServerState> {
    const existing = this.servers.get(config.id);
    if (existing && existing.state.status === 'running') {
      return existing.state;
    }

    const state: McpServerState = {
      status: 'starting',
      toolCount: 0,
    };

    const logBuffer: LogEntry[] = [];

    const addLog = (level: LogEntry['level'], message: string) => {
      logBuffer.push({ timestamp: Date.now(), level, message });
      if (logBuffer.length > config.logs.bufferSize) {
        logBuffer.shift();
      }
    };

    addLog('info', `Starting server ${config.id} (${config.command})`);

    try {
      const startTime = Date.now();

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
        cwd: config.cwd,
      });

      const client = new Client(
        { name: 'mosaic', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      const initLatencyMs = Date.now() - startTime;
      addLog('info', `Connected in ${initLatencyMs}ms`);

      const toolsResult = await client.listTools();
      const tools: McpToolInfo[] = (toolsResult.tools || []).map(t => ({
        serverId: config.id,
        name: t.name,
        description: t.description || '',
        inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
        canonicalId: toCanonicalId(config.id, t.name),
        safeId: toSafeId(config.id, t.name),
      }));

      state.status = 'running';
      state.initLatencyMs = initLatencyMs;
      state.toolCount = tools.length;

      addLog('info', `Listed ${tools.length} tools`);

      this.rateLimiter.configure(config.id, config.limits.maxCallsPerMinute);

      const instance: ServerInstance = {
        config,
        client,
        transport,
        state,
        tools,
        logBuffer,
        restartCount: existing?.restartCount ?? 0,
        lastRestartAt: existing?.lastRestartAt ?? 0,
      };

      this.servers.set(config.id, instance);

      transport.onclose = () => {
        const srv = this.servers.get(config.id);
        if (srv && srv.state.status === 'running') {
          srv.state.status = 'error';
          srv.state.lastError = 'Transport closed unexpectedly';
          addLog('error', 'Transport closed unexpectedly');
          this.attemptRestart(config.id);
        }
      };

      transport.onerror = (error: Error) => {
        addLog('error', `Transport error: ${error.message}`);
      };

      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.status = 'error';
      state.lastError = message;
      addLog('error', `Failed to start: ${message}`);

      this.servers.set(config.id, {
        config,
        client: null!,
        transport: null!,
        state,
        tools: [],
        logBuffer,
        restartCount: existing?.restartCount ?? 0,
        lastRestartAt: existing?.lastRestartAt ?? 0,
      });

      return state;
    }
  }

  async stopServer(id: string): Promise<void> {
    const instance = this.servers.get(id);
    if (!instance) return;

    instance.state.status = 'stopped';

    try {
      if (instance.client) {
        await instance.client.close();
      }
    } catch {
      // best effort
    }

    this.rateLimiter.remove(id);
  }

  async restartServer(id: string): Promise<McpServerState | null> {
    const instance = this.servers.get(id);
    if (!instance) return null;

    await this.stopServer(id);
    return this.startServer(instance.config);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
    const instance = this.servers.get(serverId);
    if (!instance) {
      return { content: `Server ${serverId} not found`, isError: true };
    }

    if (instance.state.status !== 'running') {
      return { content: `Server ${serverId} is not running (status: ${instance.state.status})`, isError: true };
    }

    const payloadSize = JSON.stringify(args).length;
    if (payloadSize > instance.config.limits.maxPayloadBytes) {
      return {
        content: `Payload too large: ${payloadSize} bytes (max: ${instance.config.limits.maxPayloadBytes})`,
        isError: true,
      };
    }

    await this.rateLimiter.acquire(serverId);

    try {
      const timeout = instance.config.timeouts.call;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);

      const result = await instance.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal, timeout: timeout }
      );

      clearTimeout(timer);
      instance.state.lastCallAt = Date.now();

      const contentParts = result.content as Array<{ type: string; text?: string }>;
      const text = contentParts
        .filter(p => p.type === 'text')
        .map(p => p.text || '')
        .join('\n');

      return {
        content: text || JSON.stringify(result.content),
        isError: result.isError === true,
      };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const isAbort = raw.includes('AbortError') || raw.includes('aborted');
      const message = isAbort
        ? `Tool call timed out after ${Math.round(instance.config.timeouts.call / 1000)}s: ${toolName}`
        : raw;
      instance.logBuffer.push({
        timestamp: Date.now(),
        level: 'error',
        message: `callTool ${toolName} failed: ${message}`,
      });
      return { content: `Tool call failed: ${message}`, isError: true };
    }
  }

  listTools(serverId: string): McpToolInfo[] {
    const instance = this.servers.get(serverId);
    if (!instance) return [];
    return [...instance.tools];
  }

  getAllTools(): McpToolInfo[] {
    const all: McpToolInfo[] = [];
    for (const instance of this.servers.values()) {
      if (instance.state.status === 'running') {
        all.push(...instance.tools);
      }
    }
    return all;
  }

  getState(serverId: string): McpServerState | null {
    const instance = this.servers.get(serverId);
    return instance ? { ...instance.state } : null;
  }

  getAllStates(): Map<string, McpServerState> {
    const states = new Map<string, McpServerState>();
    for (const [id, instance] of this.servers) {
      states.set(id, { ...instance.state });
    }
    return states;
  }

  getLogs(serverId: string): LogEntry[] {
    const instance = this.servers.get(serverId);
    if (!instance) return [];
    return [...instance.logBuffer];
  }

  getConfig(serverId: string): McpServerConfig | null {
    const instance = this.servers.get(serverId);
    return instance ? instance.config : null;
  }

  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const id of this.servers.keys()) {
      promises.push(this.stopServer(id));
    }
    await Promise.allSettled(promises);
    this.servers.clear();
  }

  private async attemptRestart(id: string): Promise<void> {
    const instance = this.servers.get(id);
    if (!instance) return;

    if (instance.restartCount >= MAX_RESTART_COUNT) {
      instance.logBuffer.push({
        timestamp: Date.now(),
        level: 'error',
        message: `Max restart count (${MAX_RESTART_COUNT}) reached, giving up`,
      });
      return;
    }

    const delay = BACKOFF_DELAYS[Math.min(instance.restartCount, BACKOFF_DELAYS.length - 1)]!;
    instance.restartCount++;
    instance.lastRestartAt = Date.now();

    instance.logBuffer.push({
      timestamp: Date.now(),
      level: 'info',
      message: `Scheduling restart #${instance.restartCount} in ${delay}ms`,
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    const current = this.servers.get(id);
    if (current && current.state.status !== 'running' && current.state.status !== 'stopped') {
      await this.startServer(instance.config);
    }
  }
}