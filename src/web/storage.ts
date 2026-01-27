import { Message } from './types';

export interface Conversation {
    id: string;
    title: string | null;
    messages: Message[];
    workspace: string | null;
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'mosaic_conversations';

export function generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getAllConversations(): Conversation[] {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        const conversations: Conversation[] = JSON.parse(data);
        return conversations.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
        return [];
    }
}

export function mergeConversations(incoming: Conversation[]): boolean {
    if (!incoming.length) return false;

    const existing = getAllConversations();
    const byId = new Map(existing.map((conv) => [conv.id, conv]));
    let changed = false;

    for (const conv of incoming) {
        const current = byId.get(conv.id);
        if (!current || conv.updatedAt > current.updatedAt) {
            byId.set(conv.id, conv);
            changed = true;
        }
    }

    if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(byId.values())));
    }

    return changed;
}

export function getConversation(id: string): Conversation | null {
    const conversations = getAllConversations();
    return conversations.find(c => c.id === id) || null;
}

export function saveConversation(conversation: Conversation): void {
    const conversations = getAllConversations();
    const existingIndex = conversations.findIndex(c => c.id === conversation.id);

    if (existingIndex !== -1) {
        conversations[existingIndex] = conversation;
    } else {
        conversations.push(conversation);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function deleteConversation(id: string): void {
    const conversations = getAllConversations();
    const filtered = conversations.filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function createNewConversation(workspace: string | null = null): Conversation {
    return {
        id: generateConversationId(),
        title: null,
        messages: [],
        workspace,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function formatWorkspace(path: string | null | undefined): string {
    if (!path) return '';

    let normalized = path.replace(/\\/g, '/');

    const homePatterns = [
        /^\/Users\/[^/]+/,
        /^\/home\/[^/]+/,
        /^[A-Z]:\/Users\/[^/]+/i,
    ];

    for (const pattern of homePatterns) {
        if (pattern.test(normalized)) {
            normalized = normalized.replace(pattern, '~');
            break;
        }
    }

    const parts = normalized.split('/').filter(Boolean);
    const maxLength = 30;

    if (normalized.length > maxLength && parts.length > 3) {
        const isHome = normalized.startsWith('~');
        const lastParts = parts.slice(-2).join('/');
        return isHome ? '~/.../' + lastParts : '.../' + lastParts;
    }

    return normalized;
}