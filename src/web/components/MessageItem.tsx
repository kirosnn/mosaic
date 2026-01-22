/** @jsxImportSource react */
import { Message } from '../types';
import '../assets/css/global.css'

interface MessageItemProps {
    message: Message;
}

export function MessageItem({ message }: MessageItemProps) {
    if (message.role === 'tool') {
        const icon = message.success === false ? '✗' : message.isRunning ? '⏳' : '✓';
        const statusClass = message.success === false ? 'error' : message.isRunning ? 'running' : 'success';

        return (
            <div className={`message tool ${statusClass}`}>
                <div className="message-bar" />
                <div className="message-content">
                    <div className="tool-header">
                        <span className="tool-icon">{icon}</span>
                        <span className="tool-name">{message.toolName || 'Tool'}</span>
                        {message.isRunning && message.runningStartTime && (
                            <span className="tool-timer">
                                {Math.floor((Date.now() - (message.runningStartTime || 0)) / 1000)}s
                            </span>
                        )}
                    </div>
                    {!message.isRunning && (
                        <pre className="tool-output">{message.content}</pre>
                    )}
                </div>
            </div>
        );
    }

    if (message.role === 'assistant') {
        return (
            <div className="message assistant">
                <div className="message-bar" />
                <div className="message-content">
                    {message.thinkingContent && (
                        <details className="thinking-section">
                            <summary>Thinking...</summary>
                            <pre className="thinking-content">{message.thinkingContent}</pre>
                        </details>
                    )}
                    <div className="assistant-text">{message.content}</div>
                </div>
            </div>
        );
    }

    return (
        <div className={`message ${message.role} ${message.isError ? 'error' : ''}`}>
            <div className="message-bar" />
            <div className="message-content">
                {message.displayContent || message.content}
            </div>
        </div>
    );
}