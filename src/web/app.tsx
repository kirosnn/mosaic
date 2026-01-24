/** @jsxImportSource react */
import { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { HomePage } from './components/HomePage';
import { ChatPage } from './components/ChatPage';
import { Message } from './types';
import { createId, extractTitle, setDocumentTitle, formatToolMessage, parseToolHeader, formatErrorMessage, DEFAULT_MAX_TOOL_LINES } from './utils';
import { Conversation, getAllConversations, getConversation, saveConversation, deleteConversation, createNewConversation } from './storage';
import { QuestionRequest } from '../utils/questionBridge';
import { ApprovalRequest } from '../utils/approvalBridge';
import './assets/css/global.css'

import { Modal } from './components/Modal';

function App() {
    const [currentPage, setCurrentPage] = useState<'home' | 'chat'>('home');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [, setTimerTick] = useState(0);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
    const [activeModal, setActiveModal] = useState<'none' | 'settings' | 'help'>('none');
    const [currentTitle, setCurrentTitle] = useState<string | null>(null);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [workspace, setWorkspace] = useState<string | null>(null);
    const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
    const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);

    const refreshConversations = useCallback(() => {
        setConversations(getAllConversations());
    }, []);

    useEffect(() => {
        refreshConversations();
        fetch('/api/workspace')
            .then(res => res.json())
            .then(data => setWorkspace(data.workspace))
            .catch(() => { });
    }, [refreshConversations]);

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
                updatedAt: Date.now(),
            };
            saveConversation(updatedConversation);
            setCurrentConversation(updatedConversation);
            refreshConversations();
        }
    }, [messages, currentTitle]);

    const handleSendMessage = async (content: string) => {
        if (!content.trim() || isProcessing) return;

        const userMessage: Message = {
            id: createId(),
            role: 'user',
            content: content,
        };

        let conversation = currentConversation;
        if (!conversation) {
            conversation = createNewConversation();
            setCurrentConversation(conversation);
        }

        if (currentPage === 'home') {
            setCurrentPage('chat');
        }

        setMessages((prev) => [...prev, userMessage]);
        setIsProcessing(true);

        try {
            const response = await fetch('/api/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage.content,
                    history: messages
                        .filter((m) => m.role === 'user' || m.role === 'assistant')
                        .map((m) => ({ role: m.role, content: m.content })),
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
            let titleExtracted = false;
            const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown>; messageId: string }>();

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

                            if (assistantMessageId === null) {
                                assistantMessageId = createId();
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

                            const { title, cleanContent, isPending, noTitle } = extractTitle(assistantChunk, titleExtracted);

                            if (title) {
                                titleExtracted = true;
                                setCurrentTitle(title);
                                setDocumentTitle(title);
                            } else if (noTitle) {
                                titleExtracted = true;
                            }

                            if (isPending) continue;

                            if (assistantMessageId === null) {
                                assistantMessageId = createId();
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
                            const toolCallMessageId = createId();
                            const toolName = event.toolName;
                            const args = event.args || {};

                            const needsApproval = toolName === 'write' || toolName === 'edit' || toolName === 'bash';
                            const isBashTool = toolName === 'bash';

                            const { name: toolDisplayName, info: toolInfo } = parseToolHeader(toolName, args);
                            const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

                            pendingToolCalls.set(event.toolCallId, {
                                toolName,
                                args,
                                messageId: toolCallMessageId,
                            });

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
                                        isRunning: isBashTool,
                                        runningStartTime: isBashTool ? Date.now() : undefined,
                                    },
                                ]);
                            }
                        } else if (event.type === 'tool-result') {
                            const pending = pendingToolCalls.get(event.toolCallId);
                            const toolName = pending?.toolName ?? event.toolName;
                            const toolArgs = pending?.args ?? {};
                            const runningMessageId = pending?.messageId;
                            pendingToolCalls.delete(event.toolCallId);

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
                                } else if (toolName === 'bash') {
                                    runningIndex = newMessages.findIndex((m) => m.toolName === 'bash' && m.isRunning === true);
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
                        } else if (event.type === 'question') {
                            setQuestionRequest(event.request);
                        } else if (event.type === 'approval') {
                            setApprovalRequest(event.request);
                        } else if (event.type === 'finish' || event.type === 'step-finish') {
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
        }
    };

    const handleLoadConversation = (conversationId: string) => {
        const conversation = getConversation(conversationId);
        if (conversation) {
            setCurrentConversation(conversation);
            setMessages(conversation.messages);
            setCurrentTitle(conversation.title);
            if (conversation.title) {
                setDocumentTitle(conversation.title);
            }
            setCurrentPage('chat');
        }
    };

    const handleDeleteConversation = (conversationId: string) => {
        deleteConversation(conversationId);
        refreshConversations();

        if (currentConversation?.id === conversationId) {
            setCurrentConversation(null);
            setMessages([]);
            setCurrentTitle(null);
            document.title = 'Mosaic';
            setCurrentPage('home');
        }
    };

    const sidebarProps = {
        isExpanded: isSidebarExpanded,
        onToggleExpand: () => setIsSidebarExpanded(!isSidebarExpanded),
        onNavigateToNewChat: () => {
            setCurrentConversation(null);
            setMessages([]);
            setCurrentTitle(null);
            document.title = 'Mosaic';
            setCurrentPage('chat');
        },
        onOpenSettings: () => setActiveModal('settings'),
        onOpenHelp: () => setActiveModal('help'),
        conversations,
        currentConversationId: currentConversation?.id || null,
        onLoadConversation: handleLoadConversation,
        onDeleteConversation: handleDeleteConversation,
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
                                setCurrentConversation(null);
                                setMessages([]);
                                setCurrentTitle(null);
                                setCurrentPage('chat');

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
                    onSendMessage={handleSendMessage}
                    sidebarProps={sidebarProps}
                    currentTitle={currentTitle}
                    workspace={workspace}
                    questionRequest={questionRequest}
                    approvalRequest={approvalRequest}
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
                        <div style={{ padding: '0.5rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Notifications</span>
                                <input type="checkbox" />
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
