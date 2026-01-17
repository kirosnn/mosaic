export interface ApprovalRequest {
  id: string;
  toolName: 'write' | 'edit' | 'bash';
  preview: {
    title: string;
    content: string;
    details?: string[];
  };
  args: Record<string, unknown>;
}

export interface ApprovalResponse {
  id: string;
  approved: boolean;
  customResponse?: string;
}

export interface ApprovalAccepted {
  toolName: 'write' | 'edit' | 'bash';
  args: Record<string, unknown>;
}

type ApprovalListener = (request: ApprovalRequest | null) => void;
type ApprovalAcceptedListener = (accepted: ApprovalAccepted) => void;

let currentRequest: ApprovalRequest | null = null;
let listeners = new Set<ApprovalListener>();
let acceptedListeners = new Set<ApprovalAcceptedListener>();
let pendingResolve: ((response: ApprovalResponse) => void) | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener(currentRequest);
  }
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function subscribeApproval(listener: ApprovalListener): () => void {
  listeners.add(listener);
  listener(currentRequest);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeApprovalAccepted(listener: ApprovalAcceptedListener): () => void {
  acceptedListeners.add(listener);
  return () => {
    acceptedListeners.delete(listener);
  };
}

function notifyApprovalAccepted(toolName: 'write' | 'edit' | 'bash', args: Record<string, unknown>): void {
  for (const listener of acceptedListeners) {
    listener({ toolName, args });
  }
}

export function getCurrentApproval(): ApprovalRequest | null {
  return currentRequest;
}

export async function requestApproval(
  toolName: 'write' | 'edit' | 'bash',
  args: Record<string, unknown>,
  preview: { title: string; content: string; details?: string[] }
): Promise<{ approved: boolean; customResponse?: string }> {
  if (pendingResolve) {
    throw new Error('An approval request is already pending');
  }

  const request: ApprovalRequest = {
    id: createId(),
    toolName,
    preview,
    args,
  };

  currentRequest = request;
  notify();

  const response = await new Promise<ApprovalResponse>((resolve) => {
    pendingResolve = resolve;
  });

  return { approved: response.approved, customResponse: response.customResponse };
}

export function respondApproval(approved: boolean, customResponse?: string): void {
  if (!currentRequest || !pendingResolve) return;

  const response: ApprovalResponse = {
    id: currentRequest.id,
    approved,
    customResponse,
  };

  const resolve = pendingResolve;
  const toolName = currentRequest.toolName;
  const args = currentRequest.args;

  pendingResolve = null;
  currentRequest = null;
  notify();

  if (approved) {
    notifyApprovalAccepted(toolName, args);
  }

  resolve(response);
}