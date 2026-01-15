export interface QuestionOption {
  label: string;
  value?: string | null;
}

export interface QuestionRequest {
  id: string;
  prompt: string;
  options: QuestionOption[];
}

export interface QuestionAnswer {
  id: string;
  index: number;
  label: string;
  value: string | null;
}

type QuestionListener = (request: QuestionRequest | null) => void;

let currentRequest: QuestionRequest | null = null;
let listeners = new Set<QuestionListener>();
let pendingResolve: ((answer: QuestionAnswer) => void) | null = null;

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

export async function askQuestion(prompt: string, options: QuestionOption[]): Promise<QuestionAnswer> {
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
  };

  currentRequest = request;
  notify();

  const answer = await new Promise<QuestionAnswer>((resolve) => {
    pendingResolve = resolve;
  });

  return answer;
}

export function answerQuestion(index: number): void {
  if (!currentRequest || !pendingResolve) return;

  const option = currentRequest.options[index];
  if (!option) return;

  const answer: QuestionAnswer = {
    id: currentRequest.id,
    index,
    label: option.label,
    value: option.value ?? null,
  };

  const resolve = pendingResolve;
  pendingResolve = null;
  currentRequest = null;
  notify();
  resolve(answer);
}