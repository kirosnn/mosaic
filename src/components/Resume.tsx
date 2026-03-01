import { useState, useEffect } from 'react';
import { useKeyboard } from '@cascadetui/react';
import { TextAttributes } from '@cascadetui/core';
import { loadConversations, deleteConversation, type ConversationHistory } from '../utils/history';

interface ResumeProps {
    onSelect: (conversation: ConversationHistory) => void;
    onCancel: () => void;
}

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '…';
}

function getFirstUserMessage(conversation: ConversationHistory): string {
    const userStep = conversation.steps.find(step => step.type === 'user');
    if (!userStep) return '';
    return userStep.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

export function Resume({ onSelect, onCancel }: ResumeProps) {
    const [conversations, setConversations] = useState<ConversationHistory[]>([]);
    const [selected, setSelected] = useState(0);
    const [hovered, setHovered] = useState<number | null>(null);

    useEffect(() => {
        setConversations(loadConversations());
    }, []);

    const handleDelete = () => {
        const conv = conversations[selected];
        if (!conv) return;

        deleteConversation(conv.id);
        const updated = conversations.filter((_, i) => i !== selected);
        setConversations(updated);

        if (selected >= updated.length && updated.length > 0) {
            setSelected(updated.length - 1);
        }
    };

    useKeyboard((key) => {
        if (key.name === 'escape') {
            onCancel();
            return;
        }
        if (key.name === 'up' || key.name === 'k') {
            setSelected(i => Math.max(0, i - 1));
            return;
        }
        if (key.name === 'down' || key.name === 'j') {
            setSelected(i => Math.min(conversations.length - 1, i + 1));
            return;
        }
        if (key.name === 'backspace' || key.name === 'delete') {
            handleDelete();
            return;
        }
        if (key.name === 'return' || key.name === 'enter') {
            const conv = conversations[selected];
            if (conv) onSelect(conv);
            return;
        }
    });

    if (conversations.length === 0) {
        return (
            <box flexDirection="column" paddingTop={1} paddingLeft={2}>
                <text fg="#2596be" attributes={TextAttributes.BOLD}>Resume Session</text>
                <text fg="gray" marginTop={1}>No sessions found.</text>
                <text fg="gray" marginTop={1} attributes={TextAttributes.DIM}>Press ESC to exit</text>
            </box>
        );
    }

    const maxItems = Math.min(15, conversations.length);
    const start = Math.max(0, Math.min(selected - 5, conversations.length - maxItems));
    const visible = conversations.slice(start, start + maxItems);

    return (
        <box flexDirection="column" paddingTop={1} paddingLeft={2}>
            <text fg="#2596be" attributes={TextAttributes.BOLD}>
                Resume Session ({conversations.length})
            </text>
            <text fg="gray" marginBottom={1} attributes={TextAttributes.DIM}>
                [↑↓] navigate  [Enter/click] select  [Del] delete  [Esc] quit
            </text>

            {visible.map((conv, i) => {
                const idx = start + i;
                const isSel = idx === selected;
                const isHovered = hovered === idx;
                const title = conv.title || 'Untitled';
                const msg = getFirstUserMessage(conv);
                const time = formatDate(conv.timestamp);
                const line = `${truncate(title, 25).padEnd(26)} ${truncate(msg, 40).padEnd(41)} ${time}`;

                return (
                    <box
                        key={conv.id}
                        flexDirection="row"
                        backgroundColor={isSel ? '#2596be' : (isHovered ? '#202020' : 'transparent')}
                        onMouseOver={() => {
                            setHovered(idx);
                        }}
                        onMouseOut={() => {
                            setHovered(prev => (prev === idx ? null : prev));
                        }}
                        onMouseDown={(event: any) => {
                            if (event?.isSelecting) return;
                            if (event?.button !== undefined && event.button !== 0) return;
                            setSelected(idx);
                            onSelect(conv);
                        }}
                    >
                        <text
                            fg={isSel ? 'black' : 'white'}
                            attributes={isSel ? TextAttributes.BOLD : undefined}
                        >
                            {isSel ? '> ' : '  '}{line}
                        </text>
                    </box>
                );
            })}

            {conversations.length > maxItems && (
                <text fg="gray" marginTop={1} attributes={TextAttributes.DIM}>
                    {selected + 1}/{conversations.length}
                </text>
            )}
        </box>
    );
}
