import { tool, type CoreTool } from 'ai';
import { z } from 'zod';

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

function withUnknownToolFallback(baseTools: Record<string, CoreTool>): Record<string, CoreTool> {
  const cache = new Map<string, CoreTool>();

  const getFallback = (toolName: string): CoreTool => {
    const cached = cache.get(toolName);
    if (cached) return cached;

    const fallback = tool({
      description: `Fallback tool used when the model calls an unknown tool name: ${toolName}`,
      parameters: z.record(z.any()).describe('Original arguments provided by the model.'),
      execute: async (_args) => {
        return { error: `Tool not available: ${toolName}` };
      },
    });
    cache.set(toolName, fallback);
    return fallback;
  };

  return new Proxy(baseTools, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && isPlausibleToolName(prop) && !(prop in target)) {
        return getFallback(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string' && isPlausibleToolName(prop)) return true;
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
