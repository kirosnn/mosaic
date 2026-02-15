/** @jsxImportSource react */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Message } from '../types';
import { MessageItem } from './MessageItem';
import { Sidebar, SidebarProps } from './Sidebar';
import { QuestionRequest } from '../../utils/questionBridge';
import { ApprovalRequest } from '../../utils/approvalBridge';
import { QuestionPanel } from './QuestionPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ThinkingIndicator } from './ThinkingIndicator';
import { getNativeMcpToolName } from '../../mcp/types';
import { findModelsDevModelById, modelAcceptsImages } from '../../utils/models';
import type { ImageAttachment } from '../../utils/images';
import { guessImageMimeType, toDataUrl } from '../../utils/images';
import '../assets/css/global.css'

interface ChatPageProps {
    messages: Message[];
    isProcessing: boolean;
    processingStartTime?: number;
    currentTokens?: number;
    onSendMessage: (message: string, images?: ImageAttachment[]) => void;
    onStopAgent?: () => void;
    sidebarProps: SidebarProps;
    currentTitle?: string | null;
    workspace?: string | null;
    questionRequest?: QuestionRequest | null;
    approvalRequest?: ApprovalRequest | null;
    requireApprovals: boolean;
    onToggleApprovals: () => void;
}

type ChatBlock =
    | { type: 'message'; key: string; message: Message }
    | { type: 'tool-group'; key: string; messages: Message[]; defaultCollapsed: boolean; summary: string };

const DISCOVERY_TOOLS = new Set([
    'explore',
    'read',
    'list',
    'glob',
    'grep',
    'fetch',
    'search',
    'search_query',
    'web_search',
]);

const EDIT_TOOLS = new Set([
    'write',
    'edit',
    'create_directory',
]);

function mapToolIdentity(identity: string): string {
    if (identity === 'nativesearch_search') return 'native_search';
    return identity;
}

function normalizeToolIdentity(toolName: string): string {
    const normalized = toolName.trim().toLowerCase();
    if (!normalized.startsWith('mcp__')) return mapToolIdentity(normalized);

    const native = getNativeMcpToolName(normalized);
    if (native) return mapToolIdentity(native.toLowerCase());

    const parts = normalized.replace(/^mcp__/, '').split('__');
    return mapToolIdentity((parts[parts.length - 1] || normalized).toLowerCase());
}

function getToolGroupToken(toolName: string): string {
    const identity = normalizeToolIdentity(toolName);

    if (DISCOVERY_TOOLS.has(identity)) return 'family:discovery';
    if (EDIT_TOOLS.has(identity)) return 'family:edit';

    if (identity.includes('search') || identity.includes('fetch') || identity.includes('find') || identity.includes('explore')) {
        return 'family:discovery';
    }

    if (identity.includes('write') || identity.includes('edit')) {
        return 'family:edit';
    }

    return `tool:${identity}`;
}

function toTitleCaseToolName(toolName: string): string {
    if (!toolName) return 'Tool';

    const raw = normalizeToolIdentity(toolName);
    if (raw === 'native_search') return 'NativeSearch';

    const words = raw
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (words.length === 0) return 'Tool';

    return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function pluralize(count: number, singular: string, plural?: string): string {
    if (count === 1) return singular;
    return plural || `${singular}s`;
}

function buildToolPhrase(toolName: string, count: number): string {
    const identity = normalizeToolIdentity(toolName);

    switch (identity) {
        case 'read':
            return `Read ${count} ${pluralize(count, 'file')}`;
        case 'write':
            return `Wrote ${count} ${pluralize(count, 'file')}`;
        case 'edit':
            return `Edited ${count} ${pluralize(count, 'file')}`;
        case 'list':
            return `Listed ${count} ${pluralize(count, 'path')}`;
        case 'glob':
            return `Matched ${count} ${pluralize(count, 'pattern')}`;
        case 'grep':
            return `Searched ${count} ${pluralize(count, 'pattern')}`;
        case 'fetch':
            return `Fetched ${count} ${pluralize(count, 'resource')}`;
        case 'explore':
            return `Explored ${count} ${pluralize(count, 'step')}`;
        case 'title':
            return `Set ${count} ${pluralize(count, 'title')}`;
        case 'plan':
            return `Updated ${count} ${pluralize(count, 'plan step')}`;
        case 'search':
        case 'search_query':
        case 'web_search':
            return `Ran ${count} ${pluralize(count, 'search')}`;
        case 'native_search':
            return `NativeSearch ${count} ${pluralize(count, 'call')}`;
        default:
            return `${toTitleCaseToolName(identity)} ${count} ${pluralize(count, 'call')}`;
    }
}

function getOrderedToolCounts(messages: Message[]): Array<{ tool: string; count: number }> {
    const counts = new Map<string, number>();
    const order: string[] = [];

    for (const msg of messages) {
        const tool = msg.toolName || 'tool';
        const identity = normalizeToolIdentity(tool);
        if (!counts.has(identity)) {
            order.push(identity);
            counts.set(identity, 1);
        } else {
            counts.set(identity, (counts.get(identity) || 0) + 1);
        }
    }

    return order.map((identity) => ({ tool: identity, count: counts.get(identity) || 0 }));
}

function summarizeToolGroup(messages: Message[]): string {
    if (messages.length === 0) return 'Tool group';

    const entries = getOrderedToolCounts(messages);
    if (entries.length === 1) {
        const only = entries[0]!;
        return buildToolPhrase(only.tool, only.count);
    }

    const parts = entries.map((entry) => buildToolPhrase(entry.tool, entry.count));
    const visibleParts = parts.slice(0, 2);
    const remaining = parts.length - visibleParts.length;
    if (remaining > 0) {
        visibleParts.push(`+${remaining} more`);
    }
    return visibleParts.join(' • ');
}

function buildChatBlocks(messages: Message[]): ChatBlock[] {
    const blocks: ChatBlock[] = [];

    for (let i = 0; i < messages.length; i += 1) {
        const current = messages[i];
        if (!current) continue;

        if (current.role !== 'tool') {
            blocks.push({
                type: 'message',
                key: current.id,
                message: current
            });
            continue;
        }

        const currentTool = current.toolName || '';
        const currentToken = getToolGroupToken(currentTool);

        const groupMessages: Message[] = [current];
        let j = i + 1;

        while (j < messages.length) {
            const candidate = messages[j];
            if (!candidate || candidate.role !== 'tool') break;
            const candidateToken = getToolGroupToken(candidate.toolName || '');
            if (candidateToken !== currentToken) break;
            groupMessages.push(candidate);
            j += 1;
        }

        if (groupMessages.length < 2) {
            blocks.push({
                type: 'message',
                key: current.id,
                message: current
            });
            continue;
        }

        blocks.push({
            type: 'tool-group',
            key: `${groupMessages[0]?.id || i}:${groupMessages[groupMessages.length - 1]?.id || j}`,
            messages: groupMessages,
            defaultCollapsed: true,
            summary: summarizeToolGroup(groupMessages)
        });

        i = j - 1;
    }

    return blocks;
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

function getPlanProgress(messages: Message[]): { inProgressStep?: string; nextStep?: string } {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!message || message.role !== 'tool' || message.toolName !== 'plan') continue;
        const result = message.toolResult;
        if (!result || typeof result !== 'object') continue;
        const obj = result as Record<string, unknown>;
        const planItems = Array.isArray(obj.plan) ? obj.plan : [];
        const normalized = planItems
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const entry = item as Record<string, unknown>;
                const step = typeof entry.step === 'string' ? entry.step.trim() : '';
                const status = typeof entry.status === 'string' ? entry.status : 'pending';
                if (!step) return null;
                return { step, status };
            })
            .filter((item): item is { step: string; status: string } => !!item);

        if (normalized.length === 0) return {};

        const inProgressIndex = normalized.findIndex(item => item.status === 'in_progress');
        const inProgressStep = inProgressIndex >= 0 ? normalized[inProgressIndex]?.step : undefined;
        let nextStep: string | undefined;

        if (inProgressIndex >= 0) {
            const after = normalized.slice(inProgressIndex + 1).find(item => item.status === 'pending');
            nextStep = after?.step;
        }

        if (!nextStep) {
            nextStep = normalized.find(item => item.status === 'pending')?.step;
        }

        return { inProgressStep, nextStep };
    }

    return {};
}

export function ChatPage({ messages, isProcessing, processingStartTime, currentTokens, onSendMessage, onStopAgent, sidebarProps, currentTitle, workspace, questionRequest, approvalRequest, requireApprovals, onToggleApprovals }: ChatPageProps) {
    const [inputValue, setInputValue] = useState('');
    const [showAttachButton, setShowAttachButton] = useState(false);
    const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
    const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<string, boolean>>({});
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const planProgress = getPlanProgress(messages);
    const chatBlocks = useMemo(() => buildChatBlocks(messages), [messages]);

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

    useEffect(() => {
        if (!showAttachButton) {
            setPendingImages([]);
        }
    }, [showAttachButton]);

    useEffect(() => {
        const checkModelSupport = async () => {
            try {
                const configRes = await fetch('/api/config');
                if (!configRes.ok) return;

                const { model } = await configRes.json();

                if (model) {
                    const result = await findModelsDevModelById(model);

                    if (result && result.model) {
                        setShowAttachButton(modelAcceptsImages(result.model));
                    } else {
                        setShowAttachButton(false);
                    }
                }
            } catch (err) {
                console.error('Failed to check model support:', err);
            }
        };

        checkModelSupport();
    }, []);

    const handleSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if ((!inputValue.trim() && pendingImages.length === 0) || isProcessing) return;
        onSendMessage(inputValue, showAttachButton ? pendingImages : []);
        setInputValue('');
        setPendingImages([]);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const toBase64 = async (file: File): Promise<string> => {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...Array.from(chunk));
        }
        return btoa(binary);
    };

    const handleAttachClick = () => {
        fileInputRef.current?.click();
    };

    const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!showAttachButton) {
            e.target.value = '';
            return;
        }
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const attachments: ImageAttachment[] = [];
        for (const file of files) {
            const mimeType = file.type || guessImageMimeType(file.name);
            if (!mimeType.startsWith('image/')) continue;
            const data = await toBase64(file);
            attachments.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: file.name,
                mimeType,
                data,
                size: file.size
            });
        }
        if (attachments.length > 0) {
            setPendingImages((prev) => [...prev, ...attachments]);
        }
        e.target.value = '';
    };

    const handleRemovePendingImage = (id: string) => {
        setPendingImages((prev) => prev.filter((img) => img.id !== id));
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

    const handleApprovalResponse = async (approved: boolean, customResponse?: string, ruleAction?: 'auto-run') => {
        try {
            await fetch('/api/approval/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approved, customResponse, ruleAction })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const formattedWorkspace = formatWorkspace(workspace);

    const toggleToolGroup = (key: string, fallback: boolean) => {
        setCollapsedToolGroups((prev) => ({
            ...prev,
            [key]: !(prev[key] ?? fallback)
        }));
    };

    return (
        <div className="home-page">
            <Sidebar {...sidebarProps} />

            <div className="main-content" style={{ padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
                <div className="chat-page">
                    <div className="chat-title-bar">
                        <div className="chat-title-actions">
                            {formattedWorkspace && (
                                <span className="chat-workspace" title={workspace || ''}>
                                    {formattedWorkspace}
                                </span>
                            )}
                            <button
                                type="button"
                                className={`approval-toggle ${requireApprovals ? '' : 'active'}`}
                                onClick={onToggleApprovals}
                                title={requireApprovals ? 'Enable auto-approve' : 'Disable auto-approve'}
                            >
                                {requireApprovals ? 'Approvals on' : 'Auto-approve'}
                            </button>
                        </div>
                    </div>
                    <div className="chat-container">
                        <div className="messages">
                            {chatBlocks.map((block) => {
                                if (block.type === 'message') {
                                    return <MessageItem key={block.key} message={block.message} />;
                                }

                                const isCollapsed = collapsedToolGroups[block.key] ?? block.defaultCollapsed;

                                return (
                                    <div key={block.key} className="tool-group">
                                        <button
                                            type="button"
                                            className="tool-group-toggle"
                                            onClick={() => toggleToolGroup(block.key, block.defaultCollapsed)}
                                            title={isCollapsed ? 'Expand tools' : 'Collapse tools'}
                                        >
                                            <span className="tool-group-summary">{block.summary}</span>
                                            <span className={`tool-group-caret ${isCollapsed ? 'collapsed' : 'expanded'}`} aria-hidden="true">
                                                <svg viewBox="0 0 24 24" focusable="false">
                                                    <path d="M8 5l8 7-8 7" />
                                                </svg>
                                            </span>
                                        </button>
                                        {!isCollapsed && block.messages.map((msg) => (
                                            <MessageItem key={msg.id} message={msg} />
                                        ))}
                                    </div>
                                );
                            })}
                            {isProcessing && !questionRequest && !approvalRequest && (
                                <div className="message assistant">
                                    <div className="message-content">
                                        <ThinkingIndicator
                                            startTime={processingStartTime}
                                            tokens={currentTokens}
                                            inProgressStep={planProgress.inProgressStep}
                                            nextStep={planProgress.nextStep}
                                        />
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
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleFilesSelected}
                            />
                            {pendingImages.length > 0 && (
                                <div className="attachment-strip">
                                    {pendingImages.map((img) => (
                                        <div key={img.id} className="attachment-item">
                                            <img src={toDataUrl(img)} alt={img.name} />
                                            <button type="button" onClick={() => handleRemovePendingImage(img.id)} title="Remove">
                                                x
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <textarea
                                ref={inputRef}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type your message..."
                                rows={2}
                            />
                            <div className="input-actions">
                                <div className="input-actions-left">
                                    {showAttachButton && (
                                        <button type="button" className="send-btn" title="Attach image" onClick={handleAttachClick}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(-45deg)' }}>
                                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                            </svg>
                                        </button>
                                    )}
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
                                            disabled={(!inputValue.trim() && pendingImages.length === 0) || !!questionRequest || !!approvalRequest}
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
