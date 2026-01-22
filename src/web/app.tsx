/** @jsxImportSource react */
import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HomePage } from './components/HomePage';
import { ChatPage } from './components/ChatPage';
import { Message } from './types';
import { createId, formatToolCallMessage, formatToolResult } from './utils';
import './assets/css/global.css'

import { Modal } from './components/Modal';

function App() {
    const [currentPage, setCurrentPage] = useState<'home' | 'chat'>('home');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [, setTimerTick] = useState(0);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
    const [activeModal, setActiveModal] = useState<'none' | 'settings' | 'help'>('none');

    useEffect(() => {
        const timerInterval = setInterval(() => {
            setTimerTick((t) => t + 1);
        }, 1000);
        return () => clearInterval(timerInterval);
    }, []);

    const handleSendMessage = async (content: string) => {
        if (!content.trim() || isProcessing) return;

        const userMessage: Message = {
            id: createId(),
            role: 'user',
            content: content,
        };

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
                                        content: assistantChunk,
                                    };
                                }
                                return newMessages;
                            });
                        } else if (event.type === 'tool-call-end') {
                            const toolCallMessageId = createId();
                            const toolName = event.toolName;
                            const args = event.args || {};

                            pendingToolCalls.set(event.toolCallId, {
                                toolName,
                                args,
                                messageId: toolCallMessageId,
                            });

                            const needsApproval = toolName === 'write' || toolName === 'edit' || toolName === 'bash';

                            if (!needsApproval) {
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: toolCallMessageId,
                                        role: 'tool',
                                        content: formatToolCallMessage(toolName, args),
                                        toolName,
                                        toolArgs: args,
                                        isRunning: true,
                                        runningStartTime: Date.now(),
                                    },
                                ]);
                            }
                        } else if (event.type === 'tool-result') {
                            const pending = pendingToolCalls.get(event.toolCallId);
                            const toolName = pending?.toolName ?? event.toolName;
                            const toolArgs = pending?.args ?? {};
                            const runningMessageId = pending?.messageId;
                            pendingToolCalls.delete(event.toolCallId);

                            const toolContent = formatToolResult(toolName, toolArgs, event.result);
                            const success = !event.result?.includes?.('Error') && !event.result?.error;

                            setMessages((prev) => {
                                const newMessages = [...prev];

                                if (runningMessageId) {
                                    const runningIndex = newMessages.findIndex((m) => m.id === runningMessageId);
                                    if (runningIndex !== -1) {
                                        newMessages[runningIndex] = {
                                            ...newMessages[runningIndex]!,
                                            content: toolContent,
                                            toolResult: event.result,
                                            success,
                                            isRunning: false,
                                            runningStartTime: undefined,
                                        };
                                        return newMessages;
                                    }
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
                        } else if (event.type === 'finish' || event.type === 'step-finish') {
                            break;
                        } else if (event.type === 'error') {
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: createId(),
                                    role: 'assistant',
                                    content: `Error: ${event.error}`,
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
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    isError: true,
                },
            ]);
        } finally {
            setIsProcessing(false);
        }
    };

    const sidebarProps = {
        isExpanded: isSidebarExpanded,
        onToggleExpand: () => setIsSidebarExpanded(!isSidebarExpanded),
        onNavigateToNewChat: () => {
            setMessages([]);
            setCurrentPage('chat');
        },
        onOpenSettings: () => setActiveModal('settings'),
        onOpenHelp: () => setActiveModal('help'),
    };

    return (
        <>
            {currentPage === 'home' ? (
                <HomePage onStartChat={handleSendMessage} sidebarProps={sidebarProps} />
            ) : (
                <ChatPage
                    messages={messages}
                    isProcessing={isProcessing}
                    onSendMessage={handleSendMessage}
                    sidebarProps={sidebarProps}
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