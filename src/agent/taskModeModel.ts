import type { CoreMessage } from 'ai';
import { getAuthForProvider, getLightweightRoute, getModelReasoningEffort, readConfig } from '../utils/config';
import { debugLog } from '../utils/debug';
import type { SmartContextMessage } from './context';
import type { Provider } from './types';
import { detectTaskMode, type TaskMode, type TaskModeDecision } from './taskMode';

const TASK_MODE_VALUES: TaskMode[] = ['chat', 'assistant_capabilities', 'explore_readonly', 'plan', 'edit', 'run', 'review'];
const TASK_MODE_CONFIDENCE_VALUES: TaskModeDecision['confidence'][] = ['high', 'medium', 'low'];
const TASK_MODE_CLASSIFIER_TIMEOUT_MS = 10000;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function contentPreview(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function getLatestUserRequest(messages: SmartContextMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function buildClassificationTranscript(messages: SmartContextMessage[]): string {
  const relevant = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-6)
    .map((message) => `${message.role}: ${contentPreview(normalizeWhitespace(message.content), message.role === 'user' ? 240 : 180)}`)
    .filter((line) => line.length > 0);

  return relevant.join('\n');
}

async function createProvider(providerName: string): Promise<Provider> {
  switch (providerName) {
    case 'openai': {
      const { OpenAIProvider } = await import('./provider/openai');
      return new OpenAIProvider();
    }
    case 'openrouter': {
      const { OpenRouterProvider } = await import('./provider/openrouter');
      return new OpenRouterProvider();
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./provider/anthropic');
      return new AnthropicProvider();
    }
    case 'google': {
      const { GoogleProvider } = await import('./provider/google');
      return new GoogleProvider();
    }
    case 'mistral': {
      const { MistralProvider } = await import('./provider/mistral');
      return new MistralProvider();
    }
    case 'xai': {
      const { XaiProvider } = await import('./provider/xai');
      return new XaiProvider();
    }
    case 'groq': {
      const { GroqProvider } = await import('./provider/groq');
      return new GroqProvider();
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./provider/ollama');
      return new OllamaProvider();
    }
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

function parseTaskModeDecision(text: string, latestUserRequest: string): TaskModeDecision | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      mode?: string;
      confidence?: string;
      reason?: string;
    };

    const mode = TASK_MODE_VALUES.find((value) => value === parsed.mode);
    if (!mode) {
      return null;
    }

    const confidence = TASK_MODE_CONFIDENCE_VALUES.find((value) => value === parsed.confidence) ?? 'medium';
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'model intent classification';

    return {
      mode,
      confidence,
      reason,
      latestUserRequest,
    };
  } catch {
    return null;
  }
}

export async function detectTaskModeWithModel(messages: SmartContextMessage[]): Promise<TaskModeDecision> {
  if (process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER === '1') {
    return detectTaskMode(messages);
  }

  const latestUserRequest = getLatestUserRequest(messages);
  if (!latestUserRequest) {
    return detectTaskMode(messages);
  }

  const config = readConfig();
  if (!config.provider || !config.model) {
    return detectTaskMode(messages);
  }
  const lightweightRoute = getLightweightRoute(config.provider, config.model, { config });
  if (!lightweightRoute.modelId) {
    return detectTaskMode(messages);
  }

  const auth = getAuthForProvider(lightweightRoute.providerId);
  if (!auth) {
    return detectTaskMode(messages);
  }

  try {
    const provider = await createProvider(lightweightRoute.providerId);
    const transcript = buildClassificationTranscript(messages);
    const systemPrompt = [
      'You classify the user intent for a coding agent.',
      'Return strict JSON only with keys: mode, confidence, reason.',
      'Allowed modes: chat, assistant_capabilities, explore_readonly, plan, edit, run, review.',
      'Choose chat only for lightweight conversation with no repository work, such as greetings, thanks, acknowledgements, or pleasantries.',
      'Choose assistant_capabilities for questions about the assistant itself: its tools, skills, permissions, limitations, or how it works locally.',
      'Do not choose assistant_capabilities for questions about a repository, project, workspace, codebase, files, git state, or implementation details.',
      'If the latest user message is short but clearly confirms continuing an existing technical task, do not choose chat; choose the underlying task mode implied by the recent conversation.',
      'Choose explore_readonly for understanding code, architecture, git status, diffs, branches, logs, or other read-only inspection.',
      'Choose plan for brainstorming or planning without implementation.',
      'Choose edit for implementing, fixing, updating, refactoring, creating, or removing code.',
      'Choose run for executing tests, builds, verification, or commands.',
      'Choose review for code review and findings-oriented analysis.',
    ].join(' ');
    const userPrompt = [
      `Latest user request: ${latestUserRequest}`,
      transcript ? `Recent conversation:\n${transcript}` : 'Recent conversation: none',
      'Return JSON only.',
    ].join('\n\n');

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), TASK_MODE_CLASSIFIER_TIMEOUT_MS);
    let output = '';

    try {
      for await (const event of provider.sendMessage(
        [{ role: 'user', content: userPrompt } as CoreMessage],
        {
          provider: lightweightRoute.providerId,
          model: lightweightRoute.modelId,
          modelReasoningEffort: getModelReasoningEffort(),
          apiKey: auth.type === 'api_key' ? auth.apiKey : undefined,
          auth,
          systemPrompt,
          tools: {},
          maxSteps: 1,
          maxContextTokens: 1200,
          maxOutputTokens: 160,
        },
        { abortSignal: abortController.signal },
      )) {
        if (event.type === 'text-delta') {
          output += event.content;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const parsed = parseTaskModeDecision(output, latestUserRequest);
    if (parsed) {
      if (parsed.confidence === 'low') {
        debugLog(`[task-mode] model routing low-confidence fallback mode=${parsed.mode} reason="${contentPreview(parsed.reason, 120)}"`);
        return detectTaskMode(messages);
      }
      debugLog(`[task-mode] model routing mode=${parsed.mode} confidence=${parsed.confidence} routerProvider=${lightweightRoute.providerId} routerModel=${lightweightRoute.modelId} reason="${contentPreview(parsed.reason, 120)}" latest="${contentPreview(latestUserRequest, 120)}"`);
      return parsed;
    }

    debugLog(`[task-mode] model routing parse-fallback output="${contentPreview(normalizeWhitespace(output), 200)}"`);
    return detectTaskMode(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`[task-mode] model routing fallback error="${contentPreview(message, 160)}"`);
    return detectTaskMode(messages);
  }
}
