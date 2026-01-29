export interface ApprovalRequest {
  id: string;
  toolName: string;
  preview: {
    title: string;
    content: string;
    details?: string[];
  };
  args: Record<string, unknown>;
  mcpMeta?: {
    serverId: string;
    serverName: string;
    canonicalId: string;
    riskHint: string;
    payloadSize: number;
  };
}

export interface ApprovalResponse {
  id: string;
  approved: boolean;
  customResponse?: string;
}

export interface ApprovalAccepted {
  toolName: string;
  args: Record<string, unknown>;
}

type ApprovalListener = (request: ApprovalRequest | null) => void;
type ApprovalAcceptedListener = (accepted: ApprovalAccepted) => void;

let currentRequest: ApprovalRequest | null = null;
let listeners = new Set<ApprovalListener>();
let acceptedListeners = new Set<ApprovalAcceptedListener>();
let pendingResolve: ((response: ApprovalResponse) => void) | null = null;
let pendingReject: ((reason?: any) => void) | null = null;
let queuedRequests: {
  request: ApprovalRequest;
  resolve: (response: ApprovalResponse) => void;
  reject: (reason?: any) => void;
}[] = [];

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

function notifyApprovalAccepted(toolName: string, args: Record<string, unknown>): void {
  for (const listener of acceptedListeners) {
    listener({ toolName, args });
  }
}

export function getCurrentApproval(): ApprovalRequest | null {
  return currentRequest;
}

export async function requestApproval(
  toolName: string,
  args: Record<string, unknown>,
  preview: { title: string; content: string; details?: string[] }
): Promise<{ approved: boolean; customResponse?: string }> {
  const mcpMeta = (args as any).__mcpMeta;
  const cleanArgs = { ...args };
  delete (cleanArgs as any).__mcpMeta;

  const request: ApprovalRequest = {
    id: createId(),
    toolName,
    preview,
    args: cleanArgs,
    ...(mcpMeta && { mcpMeta }),
  };

  const response = await new Promise<ApprovalResponse>((resolve, reject) => {
    if (pendingResolve) {
      queuedRequests.push({ request, resolve, reject });
      return;
    }

    currentRequest = request;
    pendingResolve = resolve;
    pendingReject = reject;
    notify();
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
  pendingReject = null;
  currentRequest = null;
  notify();

  if (approved) {
    notifyApprovalAccepted(toolName, args);
  }

  resolve(response);

  const next = queuedRequests.shift();
  if (next) {
    currentRequest = next.request;
    pendingResolve = next.resolve;
    pendingReject = next.reject;
    notify();
  }
}

export function cancelApproval(): void {
  if (!currentRequest || !pendingReject) return;

  const reject = pendingReject;
  pendingResolve = null;
  pendingReject = null;
  currentRequest = null;
  notify();

  reject(new Error('Interrupted by user'));

  const next = queuedRequests.shift();
  if (next) {
    currentRequest = next.request;
    pendingResolve = next.resolve;
    pendingReject = next.reject;
    notify();
  }
}
