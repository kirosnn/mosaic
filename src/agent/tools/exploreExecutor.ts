import { streamText, tool as createTool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { z } from 'zod';
import { readConfig } from '../../utils/config';
import { executeTool } from './executor';
import { getExploreAbortSignal, isExploreAborted, notifyExploreTool } from '../../utils/exploreBridge';

interface ExploreLog {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  resultPreview?: string;
}

let exploreLogs: ExploreLog[] = [];

const EXPLORE_TIMEOUT = 8 * 60 * 1000;

const EXPLORE_SYSTEM_PROMPT = `You are an exploration agent that gathers information from a codebase.

Your goal is to explore the codebase to fulfill the given purpose. You have access to these tools:
- read: Read file contents
- glob: Find files by pattern
- grep: Search for text in files
- list: List directory contents

IMPORTANT RULES:
1. Be thorough but efficient - don't repeat the same searches
2. When you have gathered enough information to answer the purpose, call the "done" tool with a comprehensive summary
3. If you cannot find the information after reasonable exploration, call "done" with what you found
4. Focus on the purpose - don't explore unrelated areas
5. Summarize findings clearly and include relevant file paths and code snippets
6. You MUST call the "done" tool when finished - this is the only way to complete the exploration`;

const MAX_STEPS = 100;

interface ExploreResult {
  success: boolean;
  result?: string;
  error?: string;
}

function createModelProvider(config: { provider: string; model: string; apiKey?: string }) {
  const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
  const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: cleanApiKey });
      return anthropic(cleanModel);
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: cleanApiKey });
      return openai(cleanModel);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: cleanApiKey });
      return google(cleanModel);
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey: cleanApiKey });
      return mistral(cleanModel);
    }
    case 'xai': {
      const xai = createXai({ apiKey: cleanApiKey });
      return xai(cleanModel);
    }
    case 'ollama':
      throw new Error('Ollama provider is not supported for explore tool');
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

let exploreDoneResult: string | null = null;

function getResultPreview(result: string | undefined): string {
  if (!result) return '';
  const lines = result.split('\n');
  if (lines.length <= 3) return result.substring(0, 200);
  return lines.slice(0, 3).join('\n').substring(0, 200) + '...';
}

function createExploreTools() {
  return {
    read: createTool({
      description: 'Read the contents of a file',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const result = await executeTool('read', args);
        const resultLen = result.result?.length || 0;
        const preview = result.success ? `${(result.result || '').split('\n').length} lines` : (result.error || 'error');
        exploreLogs.push({ tool: 'read', args, success: result.success, resultPreview: preview });
        notifyExploreTool('read', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    glob: createTool({
      description: 'Find files matching a glob pattern. Do NOT use this to list directory contents (use "list" instead).',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")'),
        path: z.string().describe('Directory to search in (use "." for workspace root)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const result = await executeTool('glob', args);
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const files = JSON.parse(result.result);
            preview = `${Array.isArray(files) ? files.length : 0} files`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'glob', args, success: result.success, resultPreview: preview });
        notifyExploreTool('glob', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    grep: createTool({
      description: 'Search for text content within files using regular expressions',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
        query: z.string().describe('Regular expression pattern to search for'),
        path: z.string().describe('Directory to search in (use "." for workspace root)'),
        case_sensitive: z.boolean().describe('Case-sensitive search (pass false for default)'),
        max_results: z.number().describe('Maximum results (pass 50 for default)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const result = await executeTool('grep', { ...args, regex: true });
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const matches = JSON.parse(result.result);
            preview = `${Array.isArray(matches) ? matches.length : 0} matches`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'grep', args, success: result.success, resultPreview: preview });
        notifyExploreTool('grep', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    list: createTool({
      description: 'List files and directories',
      parameters: z.object({
        path: z.string().describe('Path to list'),
        recursive: z.boolean().describe('List recursively (pass false for default)'),
        filter: z.string().describe('Filter pattern (pass empty string for no filter)'),
        include_hidden: z.boolean().describe('Include hidden files (pass false for default)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const result = await executeTool('list', args);
        const resultLen = result.result?.length || 0;
        let preview = result.error || 'error';
        if (result.success && result.result) {
          try {
            const items = JSON.parse(result.result);
            preview = `${Array.isArray(items) ? items.length : 0} items`;
          } catch { preview = 'ok'; }
        }
        exploreLogs.push({ tool: 'list', args, success: result.success, resultPreview: preview });
        notifyExploreTool('list', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    done: createTool({
      description: 'Call this when you have gathered enough information. Provide a comprehensive summary of your findings. This MUST be called to complete the exploration.',
      parameters: z.object({
        summary: z.string().describe('Comprehensive summary of what was found during exploration'),
      }),
      execute: async (args) => {
        exploreDoneResult = args.summary;
        return { done: true, summary: args.summary };
      },
    }),
  };
}

function formatExploreLogs(): string {
  if (exploreLogs.length === 0) return '';

  const lines = ['Tools used:'];
  for (const log of exploreLogs) {
    const argStr = log.args.path || log.args.pattern || log.args.query || '';
    const status = log.success ? '→' : '-';
    lines.push(`  ${status} ${log.tool}(${argStr}) -> ${log.resultPreview || 'ok'}`);
  }
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export async function executeExploreTool(purpose: string): Promise<ExploreResult> {
  const startTime = Date.now();
  const userConfig = readConfig();

  if (!userConfig.provider || !userConfig.model) {
    return {
      success: false,
      error: 'No provider or model configured',
    };
  }

  exploreDoneResult = null;
  exploreLogs = [];

  const abortSignal = getExploreAbortSignal();
  const timeoutId = setTimeout(() => {
    if (!exploreDoneResult) {
      exploreDoneResult = '[Exploration timed out after 8 minutes]';
    }
  }, EXPLORE_TIMEOUT);

  try {
    const model = createModelProvider({
      provider: userConfig.provider,
      model: userConfig.model,
      apiKey: userConfig.apiKey,
    });

    const tools = createExploreTools();

    const result = streamText({
      model,
      messages: [
        {
          role: 'user',
          content: `Explore the codebase to: ${purpose}`,
        },
      ],
      system: EXPLORE_SYSTEM_PROMPT,
      tools,
      maxSteps: MAX_STEPS,
      abortSignal,
    });

    let lastError: string | null = null;

    for await (const chunk of result.fullStream as any) {
      if (isExploreAborted()) {
        break;
      }
      const c: any = chunk;
      if (c.type === 'error') {
        lastError = c.error instanceof Error ? c.error.message : String(c.error);
      }
      if (exploreDoneResult !== null) {
        break;
      }
    }

    clearTimeout(timeoutId);
    const duration = formatDuration(Date.now() - startTime);

    if (isExploreAborted()) {
      const logsStr = formatExploreLogs();
      return {
        success: false,
        error: `Exploration interrupted (${duration})${logsStr ? '\n\n' + logsStr : ''}`,
      };
    }

    if (lastError && exploreLogs.length === 0) {
      return {
        success: false,
        error: lastError,
      };
    }

    const logsStr = formatExploreLogs();

    if (exploreDoneResult !== null) {
      return {
        success: true,
        result: `Completed in ${duration}\n${logsStr}\n\nSummary:\n${exploreDoneResult}`,
      };
    }

    return {
      success: true,
      result: `Completed in ${duration}\n${logsStr}\n\nExploration completed after ${MAX_STEPS} steps without explicit summary.`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = formatDuration(Date.now() - startTime);
    const logsStr = formatExploreLogs();

    if (isExploreAborted()) {
      return {
        success: false,
        error: `Exploration interrupted (${duration})${logsStr ? '\n\n' + logsStr : ''}`,
      };
    }

    return {
      success: false,
      error: `${error instanceof Error ? error.message : 'Unknown error'} (${duration})${logsStr ? '\n\n' + logsStr : ''}`,
    };
  }
}
