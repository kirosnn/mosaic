import { streamText, tool as createTool, CoreTool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { z } from 'zod';
import { readConfig, getAuthForProvider, setOAuthTokenForProvider, mapModelForOAuth } from '../../utils/config';
import { executeTool } from './executor';
import { getExploreAbortSignal, isExploreAborted, notifyExploreTool, getExploreContext } from '../../utils/exploreBridge';
import { refreshOpenAIOAuthToken, decodeJwt } from '../../auth/oauth';
import { debugLog, maskToken } from '../../utils/debug';
import {
  waitForRateLimit,
  reportRateLimitSuccess,
  reportRateLimitError,
  configureGlobalRateLimit,
  getRetryDecision,
  getRateLimitStatus,
} from '../provider/rateLimit';

interface ExploreLog {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  resultPreview?: string;
}

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return unwrapOptional(schema.unwrap());
  }
  if (schema instanceof z.ZodEffects) {
    const inner = unwrapOptional(schema.innerType());
    return inner === schema.innerType() ? schema : new z.ZodEffects({
      ...schema._def,
      schema: inner,
    });
  }
  return schema;
}

function makeAllPropertiesRequired(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) {
    const innerTransformed = makeAllPropertiesRequired(schema.innerType());
    return new z.ZodEffects({
      ...schema._def,
      schema: innerTransformed,
    });
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape: Record<string, z.ZodTypeAny> = {};
    for (const key in shape) {
      let fieldSchema = shape[key];
      fieldSchema = unwrapOptional(fieldSchema);
      if (fieldSchema instanceof z.ZodObject) {
        fieldSchema = makeAllPropertiesRequired(fieldSchema);
      } else if (fieldSchema instanceof z.ZodArray) {
        const innerType = fieldSchema.element;
        if (innerType instanceof z.ZodObject) {
          fieldSchema = z.array(makeAllPropertiesRequired(innerType));
        }
      } else if (fieldSchema instanceof z.ZodEffects) {
        const innerType = fieldSchema.innerType();
        if (innerType instanceof z.ZodObject) {
          fieldSchema = new z.ZodEffects({
            ...fieldSchema._def,
            schema: makeAllPropertiesRequired(innerType),
          });
        }
      }
      newShape[key] = fieldSchema;
    }
    return z.object(newShape);
  }
  return schema;
}

function transformToolsForResponsesApi(
  tools: Record<string, CoreTool> | undefined
): Record<string, CoreTool> | undefined {
  if (!tools) return tools;

  const transformed: Record<string, CoreTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as any;
    if (t.parameters) {
      transformed[name] = {
        ...t,
        parameters: makeAllPropertiesRequired(t.parameters),
      };
    } else {
      transformed[name] = tool;
    }
  }
  return transformed;
}

let exploreLogs: ExploreLog[] = [];

const EXPLORE_TIMEOUT = 8 * 60 * 1000;
const EXPLORE_RATE_LIMIT_KEY = 'explore';
const MAX_EXPLORE_RETRIES = 5;
const EXPLORE_RETRY_BASE_DELAY_MS = 2000;

configureGlobalRateLimit(EXPLORE_RATE_LIMIT_KEY, {
  requestsPerMinute: 30,
  requestsPerSecond: 2,
  burstLimit: 5,
  cooldownMultiplier: 2,
});

const EXPLORE_SYSTEM_PROMPT = `You are an exploration agent that gathers information from a codebase and the web.

Your goal is to explore the codebase and external documentation to fulfill the given purpose. You have access to these tools:
- read: Read file contents
- glob: Find files by pattern
- grep: Search for text in files
- list: List directory contents
- fetch: Fetch a URL and return its content as markdown (for reading documentation pages, API docs, etc.)
- search: Search the web for documentation, tutorials, API references, error solutions

# PARALLEL TOOL EXECUTION - CRITICAL

When you need to perform multiple independent operations, ALWAYS call multiple tools in a SINGLE response. Do NOT wait for one tool to complete before calling another if they are independent.

PARALLEL EXECUTION RULES:
1. Call multiple tools simultaneously when operations are independent (e.g., reading different files, searching different patterns, fetching multiple URLs)
2. Batch related operations together - if you need to read 3 files, call read 3 times in the SAME response
3. Combine different tool types - you can call glob + grep + fetch + list all at once
4. Only wait for results when the next operation depends on a previous result

Examples of GOOD parallel usage:
- Need to read src/auth.ts, src/user.ts, src/api.ts -> call read 3 times in one response
- Need to search for "authentication" AND "authorization" -> call grep 2 times in one response  
- Need to fetch React docs AND Vue docs -> call fetch 2 times in one response
- Need to glob for *.ts AND grep for "import" -> call both in one response

Examples of BAD sequential usage:
- Call read(src/auth.ts) -> wait -> call read(src/user.ts) -> wait -> call read(src/api.ts)
- Call glob(**/*.ts) -> wait -> call grep for each file individually

EFFICIENCY PRIORITY:
- The more tools you can batch together, the faster the exploration completes
- Prefer calling 5-10 tools at once over individual calls when possible
- The system handles parallel execution efficiently - use it!

# STANDARD RULES
1. Be thorough but efficient - don't repeat the same searches
2. When you have gathered enough information to answer the purpose, call the "done" tool with a comprehensive summary
3. If you cannot find the information after reasonable exploration, call "done" with what you found
4. Focus on the purpose - don't explore unrelated areas
5. Summarize findings clearly and include relevant file paths and code snippets
6. You MUST call the "done" tool when finished - this is the only way to complete the exploration
7. When the purpose involves understanding a library, framework, or external API, use search to find official documentation, then fetch to read the relevant pages
8. Prefer official documentation over blog posts or Stack Overflow when possible
9. If search is unavailable, you can still use fetch with known documentation URLs

# NO DUPLICATE CALLS
NEVER call the same tool with identical parameters twice. Track what you've already searched/read and skip duplicates.`;

const MAX_STEPS = 100;

interface ExploreResult {
  success: boolean;
  result?: string;
  error?: string;
}

interface OAuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

let currentOAuthState: OAuthState | null = null;
let exploreSystemPromptForOAuth: string | null = null;

async function refreshOAuthIfNeeded(): Promise<OAuthState | null> {
  if (!currentOAuthState?.refreshToken) return currentOAuthState;
  if (currentOAuthState.expiresAt && Date.now() < currentOAuthState.expiresAt - 60000) return currentOAuthState;
  const refreshed = await refreshOpenAIOAuthToken(currentOAuthState.refreshToken);
  if (!refreshed) return currentOAuthState;
  currentOAuthState = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    tokenType: refreshed.tokenType,
    scope: refreshed.scope,
  };
  setOAuthTokenForProvider('openai', {
    accessToken: currentOAuthState.accessToken,
    refreshToken: currentOAuthState.refreshToken,
    expiresAt: currentOAuthState.expiresAt,
    tokenType: currentOAuthState.tokenType,
    scope: currentOAuthState.scope,
  });
  return currentOAuthState;
}

const fetchWithOAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const active = await refreshOAuthIfNeeded();
  const accessToken = active?.accessToken;
  const tokenPayload = accessToken ? decodeJwt(accessToken) : null;
  const accountId = typeof tokenPayload?.chatgpt_account_id === 'string'
    ? tokenPayload.chatgpt_account_id
    : undefined;

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }
  headers.delete('authorization');
  headers.delete('Authorization');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('OpenAI-Beta', 'responses=experimental');
  headers.set('originator', 'codex_cli_rs');
  if (accountId) headers.set('chatgpt-account-id', accountId);

  let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
  const originalUrl = url;
  if (url.includes('/v1/responses')) {
    url = url.replace('/v1/responses', '/codex/responses');
  } else if (!url.includes('/codex/responses')) {
    url = url.replace('/responses', '/codex/responses');
  }

  let nextInit: RequestInit = {
    ...init,
    headers,
  };

  const method = (nextInit.method || (input instanceof Request ? input.method : 'GET')).toString().toUpperCase();
  if (method === 'POST') {
    const contentType = headers.get('content-type') ?? '';
    let bodyText: string | undefined;
    if (typeof nextInit.body === 'string') {
      bodyText = nextInit.body;
    } else if (nextInit.body instanceof Uint8Array) {
      bodyText = new TextDecoder().decode(nextInit.body);
    } else if (nextInit.body instanceof ArrayBuffer) {
      bodyText = new TextDecoder().decode(new Uint8Array(nextInit.body));
    }
    if (bodyText && (contentType.includes('application/json') || bodyText.trim().startsWith('{'))) {
      try {
        const json = JSON.parse(bodyText);
        let modified = false;
        if (json.store !== false) {
          json.store = false;
          modified = true;
        }
        if (!json.instructions && exploreSystemPromptForOAuth) {
          json.instructions = exploreSystemPromptForOAuth;
          modified = true;
        }
        if (modified) {
          nextInit = { ...nextInit, body: JSON.stringify(json) };
          headers.set('content-type', 'application/json');
        }
      } catch { }
    }
  }
  debugLog(`[oauth][explore] ${method} ${originalUrl} -> ${url} token=${maskToken(accessToken)} account=${accountId ?? ''}`);
  const res = await fetch(url, nextInit);
  if (!res.ok) {
    const text = await res.clone().text();
    debugLog(`[oauth][explore] ${method} ${url} status=${res.status} body=${text.slice(0, 500)}`);
  }
  return res;
};

type ExploreEndpoint = 'responses' | 'chat';

function createModelProvider(config: { provider: string; model: string; apiKey?: string }, endpoint?: ExploreEndpoint) {
  const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
  let cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

  const auth = getAuthForProvider(config.provider);
  const isOAuth = auth?.type === 'oauth';

  if (isOAuth && config.provider === 'openai') {
    cleanModel = mapModelForOAuth(cleanModel);
    currentOAuthState = {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: auth.expiresAt,
      tokenType: auth.tokenType,
      scope: auth.scope,
    };
  } else {
    currentOAuthState = null;
  }

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: cleanApiKey });
      return anthropic(cleanModel);
    }
    case 'openai': {
      if (isOAuth) {
        const openai = createOpenAI({
          apiKey: 'oauth',
          baseURL: 'https://chatgpt.com/backend-api',
          fetch: fetchWithOAuth as typeof fetch,
          compatibility: 'compatible',
        });
        const ep = endpoint ?? 'responses';
        return ep === 'chat' ? openai.chat(cleanModel) : openai.responses(cleanModel);
      }
      const openai = createOpenAI({ apiKey: cleanApiKey });
      return openai(cleanModel);
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey: cleanApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        compatibility: 'compatible',
        name: 'openrouter',
        headers: {
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'mosaic',
        },
      });
      return openrouter(cleanModel);
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
    case 'ollama': {
      const isCloud = cleanModel.endsWith(':cloud') || cleanModel.endsWith('-cloud') || cleanModel.includes(':cloud') || cleanModel.includes('-cloud');
      const ollamaBaseURL = isCloud && cleanApiKey
        ? 'https://ollama.com/v1'
        : 'http://localhost:11434/v1';
      let ollamaModel = cleanModel;
      if (isCloud) {
        if (ollamaModel.endsWith(':cloud')) ollamaModel = ollamaModel.slice(0, -':cloud'.length);
        else if (ollamaModel.endsWith('-cloud')) ollamaModel = ollamaModel.slice(0, -'-cloud'.length);
      }
      const ollamaOpenAI = createOpenAI({
        apiKey: cleanApiKey || 'ollama',
        baseURL: ollamaBaseURL,
        compatibility: 'compatible',
      });
      return ollamaOpenAI(ollamaModel);
    }
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
    fetch: createTool({
      description: 'Fetch a URL and return its content as markdown. Use this to read documentation pages, API references, tutorials, etc.',
      parameters: z.object({
        url: z.string().describe('The URL to fetch (must be a valid HTTP/HTTPS URL)'),
        max_length: z.number().optional().describe('Maximum characters to return (default: 10000, max: 100000)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        const result = await executeTool('fetch', { ...args, max_length: args.max_length ?? 10000 });
        const resultLen = result.result?.length || 0;
        const preview = result.success ? `${resultLen} chars` : (result.error || 'error');
        exploreLogs.push({ tool: 'fetch', args, success: result.success, resultPreview: preview });
        notifyExploreTool('fetch', args, { success: result.success, preview }, resultLen);
        if (!result.success) return { error: result.error };
        return result.result;
      },
    }),
    search: createTool({
      description: 'Search the web and return top results. Use this to find documentation, API references, tutorials, or solutions to errors.',
      parameters: z.object({
        query: z.string().describe('Search query'),
        engine: z.enum(['google', 'bing', 'duckduckgo']).optional().describe('Search engine to use (default: google)'),
      }),
      execute: async (args) => {
        if (isExploreAborted()) return { error: 'Exploration aborted' };
        try {
          const { getMcpManager, isMcpInitialized } = require('../../mcp/index');
          if (!isMcpInitialized()) {
            return { error: 'Web search unavailable (MCP not initialized)' };
          }
          const pm = getMcpManager();
          const callArgs = { query: args.query, engine: args.engine || 'google' };
          const result = await pm.callTool('navigation', 'navigation_search', callArgs);
          const resultLen = result.content?.length || 0;
          const preview = result.isError ? (result.content || 'error') : `${resultLen} chars`;
          exploreLogs.push({ tool: 'search', args: callArgs, success: !result.isError, resultPreview: preview });
          notifyExploreTool('search', callArgs, { success: !result.isError, preview }, resultLen);
          if (result.isError) return { error: result.content || 'Search failed' };
          return result.content;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          exploreLogs.push({ tool: 'search', args, success: false, resultPreview: message });
          notifyExploreTool('search', args, { success: false, preview: message }, 0);
          return { error: `Web search failed: ${message}` };
        }
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
    const argStr = log.args.path || log.args.pattern || log.args.query || log.args.url || '';
    const status = log.success ? '➔ ' : '-';
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
  debugLog(`[explore] START purpose="${purpose.slice(0, 100)}" provider=${userConfig.provider} model=${userConfig.model}`);

  const abortSignal = getExploreAbortSignal();
  const timeoutId = setTimeout(() => {
    if (!exploreDoneResult) {
      exploreDoneResult = '[Exploration timed out after 8 minutes]';
    }
  }, EXPLORE_TIMEOUT);

  try {
    const tools = createExploreTools();
    const isOpenAI = userConfig.provider === 'openai';
    const toolsToUse = isOpenAI
      ? transformToolsForResponsesApi(tools)
      : tools;

    const parentContext = getExploreContext();
    const systemPrompt = parentContext
      ? `${EXPLORE_SYSTEM_PROMPT}\n\nCONTEXT FROM PARENT CONVERSATION:\n${parentContext}`
      : EXPLORE_SYSTEM_PROMPT;

    exploreSystemPromptForOAuth = systemPrompt;

    const auth = getAuthForProvider(userConfig.provider);
    const isOAuth = auth?.type === 'oauth';
    const endpoints: ExploreEndpoint[] = (isOpenAI && isOAuth) ? ['responses', 'chat'] : ['responses'];

    let lastError: string | null = null;

    for (const endpoint of endpoints) {
      if (abortSignal?.aborted || isExploreAborted()) break;
      if (exploreDoneResult !== null) break;

      const model = createModelProvider({
        provider: userConfig.provider,
        model: userConfig.model,
        apiKey: userConfig.apiKey,
      }, endpoint);

      let exploreAttempt = 0;
      let endpointFailed = false;

      while (exploreAttempt < MAX_EXPLORE_RETRIES) {
        if (abortSignal?.aborted || isExploreAborted()) break;

        const rateLimitStatus = getRateLimitStatus(EXPLORE_RATE_LIMIT_KEY);
        if (rateLimitStatus.cooldownRemainingMs > 0) {
          debugLog(`[explore] rate limit cooldown active, waiting ${rateLimitStatus.cooldownRemainingMs}ms`);
        }

        const canProceed = await waitForRateLimit(EXPLORE_RATE_LIMIT_KEY, undefined, abortSignal);
        if (!canProceed) {
          debugLog('[explore] rate limit wait aborted');
          break;
        }

        try {
          const result = streamText({
            model,
            messages: [
              {
                role: 'user',
                content: `Explore the codebase to: ${purpose}`,
              },
            ],
            system: systemPrompt,
            tools: toolsToUse,
            maxSteps: MAX_STEPS,
            abortSignal,
            providerOptions: isOpenAI
              ? { openai: { strictJsonSchema: false } }
              : undefined,
          });

          for await (const chunk of result.fullStream as any) {
            if (isExploreAborted()) {
              break;
            }
            const c: any = chunk;
            if (c.type === 'error') {
              const errorMessage = c.error instanceof Error ? c.error.message : String(c.error);
              const decision = getRetryDecision(c.error);
              if (decision.shouldRetry) {
                lastError = errorMessage;
                throw c.error;
              }
              lastError = errorMessage;
            }
            if (exploreDoneResult !== null) {
              break;
            }
          }

          reportRateLimitSuccess(EXPLORE_RATE_LIMIT_KEY);
          endpointFailed = false;
          break;
        } catch (streamError) {
          if (abortSignal?.aborted || isExploreAborted()) break;

          const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
          const isBadRequest = errorMsg.toLowerCase().includes('bad request') || errorMsg.includes('400');

          if (isBadRequest && endpoints.indexOf(endpoint) < endpoints.length - 1) {
            debugLog(`[explore] endpoint=${endpoint} returned Bad Request, falling back to next endpoint`);
            lastError = errorMsg;
            endpointFailed = true;
            break;
          }

          const decision = getRetryDecision(streamError);
          if (!decision.shouldRetry || exploreAttempt >= MAX_EXPLORE_RETRIES - 1) {
            debugLog(`[explore] stream error not retryable or max retries reached | endpoint=${endpoint} attempt=${exploreAttempt + 1}/${MAX_EXPLORE_RETRIES} | error=${errorMsg.slice(0, 150)}`);
            lastError = errorMsg;
            reportRateLimitError(EXPLORE_RATE_LIMIT_KEY, decision.retryAfterMs);
            endpointFailed = true;
            break;
          }

          reportRateLimitError(EXPLORE_RATE_LIMIT_KEY, decision.retryAfterMs);
          const delay = Math.min(60000, EXPLORE_RETRY_BASE_DELAY_MS * Math.pow(2, exploreAttempt));
          debugLog(`[explore] retrying after error | endpoint=${endpoint} attempt=${exploreAttempt + 1}/${MAX_EXPLORE_RETRIES} | delay=${delay}ms`);

          await new Promise(resolve => setTimeout(resolve, delay));
          exploreAttempt += 1;
        }
      }

      if (!endpointFailed) break;
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
      debugLog(`[explore] DONE success toolsUsed=${exploreLogs.length} duration=${duration}`);
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

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`[explore] ERROR ${errorMsg.slice(0, 150)} duration=${duration} toolsUsed=${exploreLogs.length}`);
    return {
      success: false,
      error: `${errorMsg} (${duration})${logsStr ? '\n\n' + logsStr : ''}`,
    };
  }
}
