/** @jsxImportSource react */
import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { MessageItem } from './MessageItem';
import { Sidebar, SidebarProps } from './Sidebar';
import '../assets/css/global.css'

interface ChatPageProps {
    messages: Message[];
    isProcessing: boolean;
    onSendMessage: (message: string) => void;
    sidebarProps: SidebarProps;
    currentTitle?: string | null;
    workspace?: string | null;
}

function formatWorkspace(path: string | null | undefined): string {
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
    const maxLength = 35;

    if (normalized.length > maxLength && parts.length > 3) {
        const isHome = normalized.startsWith('~');
        const lastParts = parts.slice(-2).join('/');
        return isHome ? `~/.../` + lastParts : '.../' + lastParts;
    }

    return normalized;
}

export function ChatPage({ messages, isProcessing, onSendMessage, sidebarProps, currentTitle, workspace }: ChatPageProps) {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    useEffect(() => {
        if (inputRef.current && !isProcessing) {
            inputRef.current.focus();
        }
    }, [isProcessing]);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    const handleSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!inputValue.trim() || isProcessing) return;
        onSendMessage(inputValue);
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const formattedWorkspace = formatWorkspace(workspace);

    return (
        <div className="home-page">
            <Sidebar {...sidebarProps} />

            <div className="main-content" style={{ padding: 0 }}>
                <div className="chat-page">
                    {(currentTitle || workspace) && (
                        <div className="chat-title-bar">
                            <span className="chat-title">{currentTitle || ''}</span>
                            {formattedWorkspace && (
                                <span className="chat-workspace" title={workspace || ''}>
                                    {formattedWorkspace}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="chat-container">
                        <div className="messages">
                            {messages.map((msg) => (
                                <MessageItem key={msg.id} message={msg} />
                            ))}
                            {isProcessing && (
                                <div className="message assistant">
                                    <div className="message-content">
                                        <div className="typing-indicator">
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <form onSubmit={handleSubmit} className="input-area">
                            <textarea
                                ref={inputRef}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type your message..."
                                rows={1}
                                disabled={isProcessing}
                            />
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
