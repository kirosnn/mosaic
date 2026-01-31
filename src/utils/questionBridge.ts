export interface QuestionOption {
  label: string;
  value?: string | null;
  group?: string;
}

export interface QuestionRequest {
  id: string;
  prompt: string;
  options: QuestionOption[];
  timeout?: number;
  validation?: { pattern: string; message?: string };
}

export interface QuestionAnswer {
  id: string;
  index: number;
  label: string;
  value: string | null;
  customText?: string;
}

type QuestionListener = (request: QuestionRequest | null) => void;

let currentRequest: QuestionRequest | null = null;
let listeners = new Set<QuestionListener>();
let pendingResolve: ((answer: QuestionAnswer) => void) | null = null;
let pendingReject: ((reason?: any) => void) | null = null;
let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener(currentRequest);
  }
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function subscribeQuestion(listener: QuestionListener): () => void {
  listeners.add(listener);
  listener(currentRequest);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentQuestion(): QuestionRequest | null {
  return currentRequest;
}

export async function askQuestion(
  prompt: string,
  options: QuestionOption[],
  timeout?: number,
  validation?: { pattern: string; message?: string },
): Promise<QuestionAnswer> {
  if (pendingResolve) {
    throw new Error('A question is already pending');
  }

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required');
  }

  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('At least one option is required');
  }

  const request: QuestionRequest = {
    id: createId(),
    prompt,
    options,
    ...(timeout !== undefined && { timeout }),
    ...(validation !== undefined && { validation }),
  };

  currentRequest = request;
  notify();

  const answer = await new Promise<QuestionAnswer>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;

    if (timeout !== undefined && timeout > 0) {
      pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;
        if (pendingReject) {
          const rej = pendingReject;
          pendingResolve = null;
          pendingReject = null;
          currentRequest = null;
          notify();
          rej(new Error(`Question timed out after ${timeout}s`));
        }
      }, timeout * 1000);
    }
  });

  return answer;
}

export function answerQuestion(index: number, customText?: string): void {
  if (!currentRequest || !pendingResolve) return;

  const option = currentRequest.options[index];

  const answer: QuestionAnswer = customText
    ? {
      id: currentRequest.id,
      index: currentRequest.options.length,
      label: 'Custom response',
      value: null,
      customText,
    }
    : !option
      ? undefined!
      : {
        id: currentRequest.id,
        index,
        label: option.label,
        value: option.value ?? null,
        customText,
      };

  if (!answer) return;

  if (pendingTimeoutId !== null) {
    clearTimeout(pendingTimeoutId);
    pendingTimeoutId = null;
  }

  const resolve = pendingResolve;
  pendingResolve = null;
  pendingReject = null;
  currentRequest = null;
  notify();
  resolve(answer);
}

export function cancelQuestion(): void {
  if (!currentRequest || !pendingReject) return;

  if (pendingTimeoutId !== null) {
    clearTimeout(pendingTimeoutId);
    pendingTimeoutId = null;
  }

  const reject = pendingReject;
  pendingResolve = null;
  pendingReject = null;
  currentRequest = null;
  notify();

  reject(new Error('Interrupted by user'));
}