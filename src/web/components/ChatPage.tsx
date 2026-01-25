/** @jsxImportSource react */
import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { MessageItem } from './MessageItem';
import { Sidebar, SidebarProps } from './Sidebar';
import { QuestionRequest } from '../../utils/questionBridge';
import { ApprovalRequest } from '../../utils/approvalBridge';
import { QuestionPanel } from './QuestionPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ThinkingIndicator } from './ThinkingIndicator';
import '../assets/css/global.css'

interface ChatPageProps {
    messages: Message[];
    isProcessing: boolean;
    processingStartTime?: number;
    currentTokens?: number;
    onSendMessage: (message: string) => void;
    onStopAgent?: () => void;
    sidebarProps: SidebarProps;
    currentTitle?: string | null;
    workspace?: string | null;
    questionRequest?: QuestionRequest | null;
    approvalRequest?: ApprovalRequest | null;
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

export function ChatPage({ messages, isProcessing, processingStartTime, currentTokens, onSendMessage, onStopAgent, sidebarProps, currentTitle, workspace, questionRequest, approvalRequest }: ChatPageProps) {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, questionRequest, approvalRequest]);

    useEffect(() => {
        if (inputRef.current && !isProcessing && !questionRequest && !approvalRequest) {
            inputRef.current.focus();
        }
    }, [isProcessing, questionRequest, approvalRequest]);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isProcessing && onStopAgent) {
                e.preventDefault();
                onStopAgent();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isProcessing, onStopAgent]);

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

    const handleQuestionAnswer = async (index: number, customText?: string) => {
        try {
            await fetch('/api/question/answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index, customText })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const handleApprovalResponse = async (approved: boolean, customResponse?: string) => {
        try {
            await fetch('/api/approval/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approved, customResponse })
            });
        } catch (err) {
            console.error(err);
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
                            {isProcessing && !questionRequest && !approvalRequest && (
                                <div className="message assistant">
                                    <div className="message-content">
                                        <ThinkingIndicator startTime={processingStartTime} tokens={currentTokens} />
                                    </div>
                                </div>
                            )}

                            {questionRequest && (
                                <div className="message assistant">
                                    <div className="message-content" style={{ width: '100%', maxWidth: '100%' }}>
                                        <QuestionPanel
                                            request={questionRequest}
                                            onAnswer={handleQuestionAnswer}
                                        />
                                    </div>
                                </div>
                            )}

                            {approvalRequest && (
                                <div className="message assistant">
                                    <div className="message-content" style={{ width: '100%', maxWidth: '100%' }}>
                                        <ApprovalPanel
                                            request={approvalRequest}
                                            onRespond={handleApprovalResponse}
                                        />
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
                                rows={2}
                                disabled={isProcessing || !!questionRequest || !!approvalRequest}
                            />
                            <div className="input-actions">
                                <div className="input-actions-left">
                                    <button type="button" className="action-btn" disabled={isProcessing}>
                                        + Attach
                                    </button>
                                </div>
                                <div className="input-actions-right">
                                    {isProcessing ? (
                                        <button
                                            type="button"
                                            className="send-btn stop"
                                            onClick={onStopAgent}
                                            title="Stop (Esc)"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                <rect x="6" y="6" width="12" height="12" rx="1" />
                                            </svg>
                                        </button>
                                    ) : (
                                        <button
                                            type="submit"
                                            className="send-btn"
                                            disabled={!inputValue.trim() || !!questionRequest || !!approvalRequest}
                                            title="Send"
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="12" y1="19" x2="12" y2="5"></line>
                                                <polyline points="5 12 12 5 19 12"></polyline>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
