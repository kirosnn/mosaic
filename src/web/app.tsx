/** @jsxImportSource react */
import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { HomePage } from './components/HomePage';
import { ChatPage } from './components/ChatPage';
import { Message } from './types';
import { createId, extractTitle, setDocumentTitle, formatToolMessage, parseToolHeader, formatErrorMessage, DEFAULT_MAX_TOOL_LINES, getRandomBlendWord, normalizeToolCall } from './utils';
import { Conversation, getAllConversations, getConversation, saveConversation, deleteConversation, createNewConversation, mergeConversations } from './storage';
import { QuestionRequest } from '../utils/questionBridge';
import { ApprovalRequest } from '../utils/approvalBridge';
import { parseRoute, navigateTo, replaceTo, Route } from './router';
import './assets/css/global.css'

import { Modal } from './components/Modal';

function useRouter() {
    const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

    useEffect(() => {
        const handlePopState = () => {
            setRoute(parseRoute(window.location.pathname));
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    return route;
}

function extractTitleFromToolResult(result: unknown): string | null {
    const normalize = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
    const readTitle = (value: unknown): string | null => {
        if (!value || typeof value !== 'object') return null;
        const obj = value as Record<string, unknown>;
        const direct = typeof obj.title === 'string' ? normalize(obj.title) : '';
        if (direct) return direct;
        const nested = obj.result;
        if (typeof nested === 'string') {
            const normalized = normalize(nested);
            if (normalized) return normalized;
            return null;
        }
        if (nested && typeof nested === 'object') {
            const nestedTitle = typeof (nested as Record<string, unknown>).title === 'string'
                ? normalize((nested as Record<string, unknown>).title as string)
                : '';
            if (nestedTitle) return nestedTitle;
        }
        const output = obj.output;
        if (output && typeof output === 'object') {
            const outputTitle = typeof (output as Record<string, unknown>).title === 'string'
                ? normalize((output as Record<string, unknown>).title as string)
                : '';
            if (outputTitle) return outputTitle;
        }
        return null;
    };

    if (typeof result === 'string') {
        const trimmed = result.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            const parsedTitle = readTitle(parsed);
            if (parsedTitle) return parsedTitle;
        } catch {
        }
        const match = trimmed.match(/<title>(.*?)<\/title>/i);
        if (match && match[1]) {
            const normalized = normalize(match[1]);
            if (normalized) return normalized;
        }
        return null;
    }

    return readTitle(result);
}

function App() {
    const route = useRouter();
    const currentPage = route.page;
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStartTime, setProcessingStartTime] = useState<number | undefined>(undefined);
    const [currentTokens, setCurrentTokens] = useState(0);
    const [, setTimerTick] = useState(0);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
    const [activeModal, setActiveModal] = useState<'none' | 'settings' | 'help'>('none');
    const [currentTitle, setCurrentTitle] = useState<string | null>(null);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [workspace, setWorkspace] = useState<string | null>(null);
    const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
    const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
    const [requireApprovals, setRequireApprovals] = useState(true);

    const refreshConversations = useCallback(() => {
        setConversations(getAllConversations());
    }, []);

    const handleStopAgent = useCallback(async () => {
        try {
            await fetch('/api/stop', { method: 'POST' });
            setIsProcessing(false);
            setProcessingStartTime(undefined);
            setQuestionRequest(null);
            setApprovalRequest(null);
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'tool',
                    content: "Generation aborted. What should Mosaic do instead?",
                    toolName: 'stop',
                    success: false,
                },
            ]);
        } catch (error) {
            console.error('Failed to stop agent:', error);
        }
    }, []);

    useEffect(() => {
        refreshConversations();
        fetch('/api/workspace')
            .then(res => res.json())
            .then(data => setWorkspace(data.workspace))
            .catch(() => { });

        fetch('/api/tui-conversations')
            .then(res => res.ok ? res.json() : [])
            .then((data: Conversation[]) => {
                if (Array.isArray(data) && data.length > 0) {
                    const changed = mergeConversations(data);
                    if (changed) {
                        refreshConversations();
                    }
                }
            })
            .catch(() => { });

        fetch('/api/approvals')
            .then(res => res.ok ? res.json() : null)
            .then((data) => {
                if (data && typeof data.requireApprovals === 'boolean') {
                    setRequireApprovals(data.requireApprovals);
                }
            })
            .catch(() => { });
    }, [refreshConversations]);

    useEffect(() => {
        if (route.page === 'chat' && route.conversationId) {
            const conversation = getConversation(route.conversationId);
            if (conversation) {
                setCurrentConversation(conversation);
                setMessages(conversation.messages);
                setCurrentTitle(conversation.title);
                if (conversation.title) {
                    setDocumentTitle(conversation.title);
                }
                if (conversation.workspace) {
                    setWorkspace(conversation.workspace);
                    fetch('/api/workspace', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: conversation.workspace }),
                    }).catch(() => { });
                }
            } else {
                navigateTo({ page: 'home' });
            }
        } else if (route.page === 'chat' && !route.conversationId) {
            setCurrentConversation(null);
            setMessages([]);
            setCurrentTitle(null);
            document.title = 'Mosaic';
        } else if (route.page === 'home') {
            setCurrentConversation(null);
            setMessages([]);
            setCurrentTitle(null);
            document.title = 'Mosaic';
        }
    }, [route]);

    useEffect(() => {
        const timerInterval = setInterval(() => {
            setTimerTick((t) => t + 1);
        }, 1000);
        return () => clearInterval(timerInterval);
    }, []);

    useEffect(() => {
        if (currentConversation && messages.length > 0) {
            const updatedConversation: Conversation = {
                ...currentConversation,
                messages,
                title: currentTitle,
                workspace: currentConversation.workspace || workspace,
                updatedAt: Date.now(),
            };
            saveConversation(updatedConversation);
            setCurrentConversation(updatedConversation);
            refreshConversations();
        }
    }, [messages, currentTitle]);

    const handleSendMessage = async (content: string, images: Message['images'] = []) => {
        if ((!content.trim() && images.length === 0) || isProcessing) return;

        const userMessage: Message = {
            id: createId(),
            role: 'user',
            content: content,
            images: images.length > 0 ? images : undefined,
        };

        let conversation = currentConversation;
        if (!conversation) {
            conversation = createNewConversation(workspace);
            setCurrentConversation(conversation);
            replaceTo({ page: 'chat', conversationId: conversation.id });
        }

        if (currentPage === 'home') {
            navigateTo({ page: 'chat', conversationId: conversation.id });
        }

        setMessages((prev) => [...prev, userMessage]);
        setIsProcessing(true);
        setProcessingStartTime(Date.now());
        setCurrentTokens(0);
        let totalChars = 0;
        const estimateTokens = () => Math.ceil(totalChars / 4);

        try {
            const response = await fetch('/api/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage.content,
                    images: userMessage.images || [],
                    history: messages
                        .filter((m) => m.role === 'user' || m.role === 'assistant')
                        .map((m) => ({ role: m.role, content: m.content, images: m.images || [] })),
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let assistantChunk = '';
            let thinkingChunk = '';
            let assistantMessageId: string | null = null;
            let assistantStartTime: number | null = null;
            let titleExtracted = false;
            const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown>; messageId: string }>();
            let exploreMessageId: string | null = null;
            let exploreTools: Array<{ tool: string; info: string; success: boolean }> = [];
            let explorePurpose = '';

            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter((line) => line.trim());

                for (const line of lines) {
                    try {
                        const event = JSON.parse(line);

                        if (event.type === 'reasoning-delta') {
                            thinkingChunk += event.content;
                            totalChars += event.content.length;
                            setCurrentTokens(estimateTokens());

                            if (assistantMessageId === null) {
                                assistantMessageId = createId();
                                assistantStartTime = Date.now();
                            }

                            setMessages((prev) => {
                                const newMessages = [...prev];
                                const messageIndex = newMessages.findIndex((m) => m.id === assistantMessageId);

                                if (messageIndex === -1) {
                                    newMessages.push({
                                        id: assistantMessageId!,
                                        role: 'assistant',
                                        content: assistantChunk,
                                        thinkingContent: thinkingChunk,
                                    });
                                } else {
                                    newMessages[messageIndex] = {
                                        ...newMessages[messageIndex]!,
                                        thinkingContent: thinkingChunk,
                                    };
                                }
                                return newMessages;
                            });
                        } else if (event.type === 'text-delta') {
                            assistantChunk += event.content;
                            totalChars += event.content.length;
                            setCurrentTokens(estimateTokens());

                            const { title, cleanContent, isPending, noTitle, isTitlePseudoCall } = extractTitle(assistantChunk, titleExtracted);

                            if (title) {
                                titleExtracted = true;
                                setCurrentTitle(title);
                                setDocumentTitle(title);

                                if (isTitlePseudoCall) {
                                    const toolArgs = { title } as Record<string, unknown>;
                                    const toolResult = { title } as Record<string, unknown>;
                                    const { content: toolContent, success } = formatToolMessage('title', toolArgs, toolResult, { maxLines: DEFAULT_MAX_TOOL_LINES });
                                    setMessages((prev) => ([
                                        ...prev,
                                        {
                                            id: createId(),
                                            role: 'tool',
                                            content: toolContent,
                                            toolName: 'title',
                                            toolArgs,
                                            toolResult,
                                            success,
                                        },
                                    ]));
                                }
                            } else if (noTitle) {
                                titleExtracted = true;
                            }

                            if (isPending) continue;

                            if (assistantMessageId === null) {
                                assistantMessageId = createId();
                                assistantStartTime = Date.now();
                            }

                            setMessages((prev) => {
                                const newMessages = [...prev];
                                const messageIndex = newMessages.findIndex((m) => m.id === assistantMessageId);

                                if (messageIndex === -1) {
                                    newMessages.push({
                                        id: assistantMessageId!,
                                        role: 'assistant',
                                        content: cleanContent,
                                        thinkingContent: thinkingChunk,
                                    });
                                } else {
                                    newMessages[messageIndex] = {
                                        ...newMessages[messageIndex]!,
                                        content: cleanContent,
                                    };
                                }
                                return newMessages;
                            });
                        } else if (event.type === 'tool-call-end') {
                            totalChars += JSON.stringify(event.args || {}).length;
                            setCurrentTokens(estimateTokens());

                            const toolCallMessageId = createId();
                            const normalized = normalizeToolCall(event.toolName, event.args || {});
                            const toolName = normalized.toolName;
                            const args = normalized.args;

                            const needsApproval = toolName === 'write' || toolName === 'edit' || toolName === 'bash';
                            const isBashTool = toolName === 'bash';
                            const isExploreTool = toolName === 'explore';

                            const { name: toolDisplayName, info: toolInfo } = parseToolHeader(toolName, args);
                            const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

                            pendingToolCalls.set(event.toolCallId, {
                                toolName,
                                args,
                                messageId: toolCallMessageId,
                            });

                            if (isExploreTool) {
                                exploreMessageId = toolCallMessageId;
                                exploreTools = [];
                                explorePurpose = (args.purpose as string) || 'exploring...';
                                console.log('[CLIENT] Set exploreMessageId:', exploreMessageId);
                            }

                            if (!needsApproval) {
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: toolCallMessageId,
                                        role: 'tool',
                                        content: runningContent,
                                        toolName,
                                        toolArgs: args,
                                        success: true,
                                        isRunning: isBashTool || isExploreTool,
                                        runningStartTime: (isBashTool || isExploreTool) ? Date.now() : undefined,
                                    },
                                ]);
                            }
                        } else if (event.type === 'explore-tool') {
                            console.log('[CLIENT] explore-tool received:', event.toolName, 'exploreMessageId:', exploreMessageId);
                            const info = (event.args?.path || event.args?.pattern || event.args?.query || '') as string;
                            const shortInfo = info.length > 40 ? info.substring(0, 37) + '...' : info;
                            exploreTools.push({ tool: event.toolName, info: shortInfo, success: event.success });

                            totalChars += event.tokenEstimate * 4;
                            setCurrentTokens(estimateTokens());

                            if (exploreMessageId) {
                                console.log('[CLIENT] Updating message:', exploreMessageId);
                                setMessages((prev) => {
                                    const newMessages = [...prev];
                                    const idx = newMessages.findIndex(m => m.id === exploreMessageId);
                                    console.log('[CLIENT] Found message at index:', idx);
                                    if (idx !== -1) {
                                        const toolLines = exploreTools.map(t => {
                                            const icon = t.success ? '+' : '-';
                                            return `  ${icon} ${t.tool}(${t.info})`;
                                        });
                                        const newContent = `Explore (${explorePurpose})\n${toolLines.join('\n')}`;
                                        newMessages[idx] = { ...newMessages[idx]!, content: newContent };
                                    }
                                    return newMessages;
                                });
                            } else {
                                console.log('[CLIENT] exploreMessageId is null!');
                            }
                        } else if (event.type === 'tool-result') {
                            const toolResultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                            totalChars += toolResultStr.length;
                            setCurrentTokens(estimateTokens());

                            const pending = pendingToolCalls.get(event.toolCallId);
                            const toolName = pending?.toolName ?? event.toolName;
                            const toolArgs = pending?.args ?? {};
                            const runningMessageId = pending?.messageId;
                            pendingToolCalls.delete(event.toolCallId);

                            if (toolName === 'title') {
                                const nextTitle = extractTitleFromToolResult(event.result);
                                if (nextTitle) {
                                    setCurrentTitle(nextTitle);
                                    setDocumentTitle(nextTitle);
                                }
                            }

                            if (toolName === 'explore') {
                                exploreMessageId = null;
                            }

                            const { content: toolContent, success } = formatToolMessage(
                                toolName,
                                toolArgs,
                                event.result,
                                { maxLines: DEFAULT_MAX_TOOL_LINES }
                            );

                            setMessages((prev) => {
                                const newMessages = [...prev];

                                let runningIndex = -1;
                                if (runningMessageId) {
                                    runningIndex = newMessages.findIndex((m) => m.id === runningMessageId);
                                } else if (toolName === 'bash' || toolName === 'explore') {
                                    runningIndex = newMessages.findIndex((m) => m.toolName === toolName && m.isRunning === true);
                                }

                                if (runningIndex !== -1) {
                                    newMessages[runningIndex] = {
                                        ...newMessages[runningIndex]!,
                                        content: toolContent,
                                        toolArgs: toolArgs,
                                        toolResult: event.result,
                                        success,
                                        isRunning: false,
                                        runningStartTime: undefined,
                                    };
                                    return newMessages;
                                }

                                newMessages.push({
                                    id: createId(),
                                    role: 'tool',
                                    content: toolContent,
                                    toolName,
                                    toolArgs,
                                    toolResult: event.result,
                                    success,
                                });
                                return newMessages;
                            });

                            assistantChunk = '';
                            thinkingChunk = '';
                            assistantMessageId = null;
                            assistantStartTime = null;
                        } else if (event.type === 'question') {
                            setQuestionRequest(event.request);
                        } else if (event.type === 'approval') {
                            setApprovalRequest(event.request);
                        } else if (event.type === 'finish' || event.type === 'step-finish') {
                            if (assistantMessageId && assistantStartTime) {
                                const responseDuration = Date.now() - assistantStartTime;
                                if (responseDuration > 60000) {
                                    const blendWord = getRandomBlendWord();
                                    setMessages((prev) => {
                                        const newMessages = [...prev];
                                        const idx = newMessages.findIndex(m => m.id === assistantMessageId);
                                        if (idx !== -1) {
                                            newMessages[idx] = {
                                                ...newMessages[idx]!,
                                                responseDuration,
                                                blendWord,
                                            };
                                        }
                                        return newMessages;
                                    });
                                }
                            }
                            break;
                        } else if (event.type === 'stopped') {
                            break;
                        } else if (event.type === 'error') {
                            const errorContent = formatErrorMessage('API', event.error);
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: createId(),
                                    role: 'assistant',
                                    content: errorContent,
                                    isError: true,
                                },
                            ]);
                            break;
                        }
                    } catch (parseError) {
                        console.error('Failed to parse event:', parseError);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorContent = formatErrorMessage('Mosaic', errorMessage);
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    content: errorContent,
                    isError: true,
                },
            ]);
        } finally {
            setIsProcessing(false);
            setProcessingStartTime(undefined);
        }
    };

    const handleLoadConversation = (conversationId: string) => {
        navigateTo({ page: 'chat', conversationId });
    };

    const handleDeleteConversation = (conversationId: string) => {
        if (conversationId.startsWith('tui_')) {
            fetch('/api/tui-conversation/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: conversationId }),
            }).catch(() => { });
        }
        deleteConversation(conversationId);
        refreshConversations();

        if (currentConversation?.id === conversationId) {
            navigateTo({ page: 'home' });
        }
    };

    const handleRenameConversation = (conversationId: string, newTitle: string) => {
        const conversation = getConversation(conversationId);
        if (conversation) {
            const updated: Conversation = {
                ...conversation,
                title: newTitle,
                updatedAt: Date.now(),
            };
            saveConversation(updated);
            refreshConversations();

            if (currentConversation?.id === conversationId) {
                setCurrentConversation(updated);
                setCurrentTitle(newTitle);
                setDocumentTitle(newTitle);
            }

            if (conversationId.startsWith('tui_')) {
                fetch('/api/tui-conversation/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: conversationId, title: newTitle }),
                }).catch(() => { });
            }
        }
    };

    const handleToggleApprovals = async () => {
        try {
            const next = !requireApprovals;
            const res = await fetch('/api/approvals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requireApprovals: next }),
            });
            if (res.ok) {
                setRequireApprovals(next);
                if (!next) {
                    setApprovalRequest(null);
                }
            }
        } catch (error) {
            console.error('Failed to toggle approvals:', error);
        }
    };

    const handleNavigateHome = () => {
        navigateTo({ page: 'home' });
    };

    const sidebarProps = {
        isExpanded: isSidebarExpanded,
        onToggleExpand: () => setIsSidebarExpanded(!isSidebarExpanded),
        onNavigateToNewChat: () => {
            navigateTo({ page: 'chat', conversationId: null });
        },
        onNavigateHome: handleNavigateHome,
        onOpenSettings: () => setActiveModal('settings'),
        onOpenHelp: () => setActiveModal('help'),
        conversations,
        currentConversationId: currentConversation?.id || null,
        onLoadConversation: handleLoadConversation,
        onDeleteConversation: handleDeleteConversation,
        onRenameConversation: handleRenameConversation,
    };

    return (
        <>
            {currentPage === 'home' ? (
                <HomePage
                    onStartChat={handleSendMessage}
                    onOpenProject={async (path) => {
                        try {
                            const res = await fetch('/api/workspace', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path }),
                            });

                            if (res.ok) {
                                setWorkspace(path);
                                navigateTo({ page: 'chat', conversationId: null });

                                await fetch('/api/add-recent-project', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ path }),
                                });
                            }
                        } catch (error) {
                            console.error('Failed to open project:', error);
                        }
                    }}
                    sidebarProps={sidebarProps}
                />
            ) : (
                <ChatPage
                    messages={messages}
                    isProcessing={isProcessing}
                    processingStartTime={processingStartTime}
                    currentTokens={currentTokens}
                    onSendMessage={handleSendMessage}
                    onStopAgent={handleStopAgent}
                    sidebarProps={sidebarProps}
                    currentTitle={currentTitle}
                    workspace={workspace}
                    questionRequest={questionRequest}
                    approvalRequest={approvalRequest}
                    requireApprovals={requireApprovals}
                    onToggleApprovals={handleToggleApprovals}
                />
            )}

            <Modal
                isOpen={activeModal === 'settings'}
                onClose={() => setActiveModal('none')}
                title="Settings"
            >
                <div>
                    <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Application Settings</h3>
                    <p>Customize your Mosaic experience here.</p>
                    <div style={{ marginTop: '1rem' }}>
                        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Dark Mode</span>
                                <input type="checkbox" checked readOnly />
                            </label>
                        </div>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={activeModal === 'help'}
                onClose={() => setActiveModal('none')}
                title="Help & Support"
            >
                <div>
                    <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Getting Started</h3>
                    <p>Welcome to Mosaic! Use the sidebar to navigate between your projects and chat history.</p>
                    <ul style={{ marginTop: '1rem', paddingLeft: '1.5rem' }}>
                        <li>Use <strong>+</strong> to start a new chat.</li>
                        <li>Use the layout button to expand/collapse the sidebar.</li>
                        <li>Type your message in the chat input to interact with the AI.</li>
                    </ul>
                </div>
            </Modal>

        </>
    );
}


const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
