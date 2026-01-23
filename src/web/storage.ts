import { Message } from './types';

export interface Conversation {
    id: string;
    title: string | null;
    messages: Message[];
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
        return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
        return [];
    }
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

export function createNewConversation(): Conversation {
    return {
        id: generateConversationId(),
        title: null,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
