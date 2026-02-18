import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { debugLog } from '../../utils/debug';

import { bash } from './bash.ts';
import { list } from './list.ts';
import { read } from './read.ts';
import { write } from './write.ts';
import { glob } from './glob.ts';
import { grep } from './grep.ts';
import { edit } from './edit.ts';
import { question } from './question.ts';
import { explore } from './explore.ts';
import { fetch } from './fetch.ts';
import { plan } from './plan.ts';
import { title } from './title';

export const tools: Record<string, CoreTool> = {
  read,
  write,
  list,
  bash,
  glob,
  grep,
  edit,
  question,
  explore,
  fetch,
  plan,
  title,
};

function isPlausibleToolName(name: string): boolean {
  if (!name) return false;
  if (name === 'then' || name === 'toString' || name === 'valueOf' || name === 'constructor') return false;
  if (name.startsWith('__')) return false;
  return /^[a-zA-Z][a-zA-Z0-9_\-]*$/.test(name);
}

function parseEmbeddedToolCall(name: string): { toolName: string; embeddedArgs: Record<string, unknown> } | null {
  const trimmed = name.trim();
  const matchA = trimmed.match(/^(\{[\s\S]*\})\s*\[\s*\]\s*([a-zA-Z][a-zA-Z0-9_\-]*)$/);
  if (matchA) {
    try {
      const parsed = JSON.parse(matchA[1] as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { toolName: matchA[2] as string, embeddedArgs: parsed as Record<string, unknown> };
      }
    } catch {
    }
  }
  const matchB = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_\-]*)\s*\[\s*\]\s*(\{[\s\S]*\})$/);
  if (matchB) {
    try {
      const parsed = JSON.parse(matchB[2] as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { toolName: matchB[1] as string, embeddedArgs: parsed as Record<string, unknown> };
      }
    } catch {
    }
  }
  return null;
}

function resolveEmbeddedTool(
  toolName: string,
  args: Record<string, unknown>,
  baseTools: Record<string, CoreTool>
): { toolName: string; args: Record<string, unknown>; tool: CoreTool } | null {
  const parsed = parseEmbeddedToolCall(toolName);
  if (!parsed) return null;
  const tool = baseTools[parsed.toolName];
  if (!tool) return null;
  const mergedArgs = Object.keys(args).length > 0 ? { ...parsed.embeddedArgs, ...args } : parsed.embeddedArgs;
  return { toolName: parsed.toolName, args: mergedArgs, tool };
}

function resolveTrustedAlias(toolName: string, baseTools: Record<string, CoreTool>): string | null {
  const trimmed = toolName.trim();
  if (!trimmed) return null;
  if (trimmed in baseTools) return trimmed;

  const patterns = [
    /^functions?[._-]([a-zA-Z][a-zA-Z0-9_\-]*)$/,
    /^tools?[._-]([a-zA-Z][a-zA-Z0-9_\-]*)$/,
    /^([a-zA-Z][a-zA-Z0-9_\-]*)_tool$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1];
    if (candidate && candidate in baseTools) return candidate;
  }

  const normalized = trimmed.replace(/-/g, '_');
  if (normalized in baseTools) return normalized;
  return null;
}

function withUnknownToolFallback(baseTools: Record<string, CoreTool>): Record<string, CoreTool> {
  const cache = new Map<string, CoreTool>();
  const unknownAttempts = new Map<string, number>();

  const getAvailableToolsHint = () => {
    const names = Object.keys(baseTools).sort();
    const preview = names.slice(0, 16).join(', ');
    const suffix = names.length > 16 ? ` (+${names.length - 16} more)` : '';
    return `${preview}${suffix}`;
  };

  const getStrictUnknown = (toolName: string): CoreTool => {
    const strictKey = `strict:${toolName}`;
    const cached = cache.get(strictKey);
    if (cached) return cached;

    const strict = tool({
      description: `Strict unknown tool error for: ${toolName}`,
      parameters: z.record(z.any()).describe('Original arguments provided by the model.'),
      execute: async (_args) => {
        const count = (unknownAttempts.get(toolName) ?? 0) + 1;
        unknownAttempts.set(toolName, count);
        debugLog(`[tools] unknown tool attempt name=${toolName} count=${count}`);
        return { error: `Unknown tool "${toolName}". Available tools: ${getAvailableToolsHint()}` };
      },
    });

    cache.set(strictKey, strict);
    return strict;
  };

  const getFallback = (toolName: string): CoreTool => {
    const cached = cache.get(toolName);
    if (cached) return cached;

    const embedded = resolveEmbeddedTool(toolName, {}, baseTools);
    if (embedded) {
      debugLog(`[tools] embedded tool redirect ${toolName} -> ${embedded.toolName}`);
      const redirected = tool({
        description: `Redirected tool call: ${toolName} -> ${embedded.toolName}`,
        parameters: z.record(z.any()).describe('Original arguments provided by the model.'),
        execute: async (args) => {
          const mergedArgs = Object.keys(args).length > 0 ? { ...embedded.args, ...args } : embedded.args;
          const inner = baseTools[embedded.toolName] as any;
          if (inner && typeof inner.execute === 'function') {
            return inner.execute(mergedArgs);
          }
          return { error: `Tool not available: ${embedded.toolName}` };
        },
      });
      cache.set(toolName, redirected);
      return redirected;
    }

    const alias = resolveTrustedAlias(toolName, baseTools);
    if (alias) {
      debugLog(`[tools] alias redirect ${toolName} -> ${alias}`);
      const redirected = tool({
        description: `Trusted alias redirect: ${toolName} -> ${alias}`,
        parameters: z.record(z.any()).describe('Original arguments provided by the model.'),
        execute: async (args) => {
          const inner = baseTools[alias] as any;
          if (inner && typeof inner.execute === 'function') {
            return inner.execute(args);
          }
          return { error: `Tool not available: ${alias}` };
        },
      });
      cache.set(toolName, redirected);
      return redirected;
    }

    return getStrictUnknown(toolName);
  };

  return new Proxy(baseTools, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target)) {
        const embedded = parseEmbeddedToolCall(prop);
        if (embedded && embedded.toolName in target) {
          return getFallback(prop);
        }
        if (resolveTrustedAlias(prop, target)) {
          return getFallback(prop);
        }
        if (isPlausibleToolName(prop)) {
          return getStrictUnknown(prop);
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string') {
        const embedded = parseEmbeddedToolCall(prop);
        if (embedded && embedded.toolName in target) return true;
        if (resolveTrustedAlias(prop, target)) return true;
        if (isPlausibleToolName(prop) && prop in target) return true;
      }
      return Reflect.has(target, prop);
    },
  });
}

export function getTools(): Record<string, CoreTool> {
  try {
    const { getMcpCatalog, isMcpInitialized } = require('../../mcp/index');
    if (isMcpInitialized()) {
      const catalog = getMcpCatalog();
      const mcpTools = catalog.getExposedTools();
      return withUnknownToolFallback({ ...tools, ...mcpTools });
    }
  } catch {
    // MCP not available, return internal tools only
  }
  return withUnknownToolFallback(tools);
}
