import { streamText, tool as createTool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { z } from 'zod';
import { readConfig } from '../../utils/config';
import { executeTool } from './executor';

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

const MAX_STEPS = 50;

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

function createExploreTools() {
  return {
    read: createTool({
      description: 'Read the contents of a file',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
      }),
      execute: async (args) => {
        const result = await executeTool('read', args);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    glob: createTool({
      description: 'Find files matching a glob pattern',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")'),
        path: z.string().optional().describe('Directory to search in (default: workspace root)'),
      }),
      execute: async (args) => {
        const result = await executeTool('glob', args);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    grep: createTool({
      description: 'Search for text content within files',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
        query: z.string().describe('Text to search for'),
        path: z.string().optional().describe('Directory to search in'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive search'),
        max_results: z.number().optional().describe('Maximum results'),
      }),
      execute: async (args) => {
        const result = await executeTool('grep', args);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    list: createTool({
      description: 'List files and directories',
      parameters: z.object({
        path: z.string().describe('Path to list'),
        recursive: z.boolean().optional().describe('List recursively'),
        filter: z.string().optional().describe('Filter pattern'),
        include_hidden: z.boolean().optional().describe('Include hidden files'),
      }),
      execute: async (args) => {
        const result = await executeTool('list', args);
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

export async function executeExploreTool(purpose: string): Promise<ExploreResult> {
  const userConfig = readConfig();

  if (!userConfig.provider || !userConfig.model) {
    return {
      success: false,
      error: 'No provider or model configured',
    };
  }

  exploreDoneResult = null;

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
    });

    for await (const chunk of result.fullStream as any) {
      if (exploreDoneResult !== null) {
        break;
      }
    }

    if (exploreDoneResult !== null) {
      return {
        success: true,
        result: exploreDoneResult,
      };
    }

    return {
      success: true,
      result: `Exploration completed after ${MAX_STEPS} steps without explicit done call.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during exploration',
    };
  }
}
