/** @jsxImportSource react */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { parseDiffLine, getDiffLineColors } from '../utils';
import '../assets/css/global.css'

function BlendIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" className="blend-icon">
            <circle cx="12" cy="6.5" r="1.4"/>
            <circle cx="17.5" cy="12" r="1.4"/>
            <circle cx="12" cy="17.5" r="1.4"/>
            <circle cx="6.5" cy="12" r="1.4"/>
        </svg>
    );
}

function formatBlendTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }

    if (minutes > 0) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    return `${seconds}s`;
}

interface MessageItemProps {
    message: Message;
}

function renderDiffLine(line: string, index: number): React.ReactElement {
    const parsed = parseDiffLine(line);

    if (!parsed.isDiffLine) {
        return (
            <div key={index} className="tool-line">
                {line}
            </div>
        );
    }

    const colors = getDiffLineColors(parsed);

    return (
        <div
            key={index}
            className={`tool-line diff-line ${parsed.isAdded ? 'added' : ''} ${parsed.isRemoved ? 'removed' : ''}`}
            style={{ backgroundColor: colors.contentBackground }}
        >
            <span
                className="diff-label"
                style={{ backgroundColor: colors.labelBackground }}
            >
                {parsed.prefix}{parsed.lineNumber?.padStart(4, ' ')}
            </span>
            <span className="diff-separator">|</span>
            <span className="diff-content">{parsed.content}</span>
        </div>
    );
}

function parseToolHeader(content: string): { name: string; info: string | null; bodyLines: string[] } {
    const lines = content.split('\n');
    const firstLine = lines[0] || '';
    const bodyLines = lines.slice(1);

    const match = firstLine.match(/^(.+?)\s*\((.+)\)$/);
    if (match) {
        return { name: match[1]!, info: match[2]!, bodyLines };
    }

    return { name: firstLine, info: null, bodyLines };
}

export function MessageItem({ message }: MessageItemProps) {
    if (message.role === 'tool') {
        const statusClass = message.success === false ? 'error' : message.isRunning ? 'running' : 'success';

        const { name, info, bodyLines } = parseToolHeader(message.content);

        return (
            <div className={`message tool ${statusClass}`}>
                <div className="message-content">
                    <div className="tool-header">
                        <span className={`tool-name ${message.toolName === 'stop' ? 'no-bold' : ''}`}>{name}</span>
                        {info && <span className="tool-info">({info})</span>}
                        {message.isRunning && message.runningStartTime && (
                            <span className="tool-timer">
                                {Math.floor((Date.now() - (message.runningStartTime || 0)) / 1000)}s
                            </span>
                        )}
                    </div>
                    {bodyLines.length > 0 && (
                        <div className="tool-output">
                            {bodyLines.map((line, index) => renderDiffLine(line, index))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (message.role === 'assistant') {
        const showBlend = message.responseDuration && message.responseDuration > 60000;

        return (
            <>
                <div className="message assistant">
                    <div className="message-content">
                        {message.thinkingContent && (
                            <details className="thinking-section">
                                <summary>Thinking...</summary>
                                <pre className="thinking-content">{message.thinkingContent}</pre>
                            </details>
                        )}
                        <div className="markdown-content">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({ node, className, children, ...props }) {
                                        const match = /language-(\w+)/.exec(className || '');
                                        return match ? (
                                            <SyntaxHighlighter
                                                style={vscDarkPlus}
                                                language={match[1]}
                                                PreTag="div"
                                                {...props}
                                            >
                                                {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                        ) : (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    }
                                }}
                            >
                                {message.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
                {showBlend && (
                    <div className="blend-indicator">
                        <BlendIcon />
                        <span className="blend-text">
                            {message.blendWord || 'Blended'} for {formatBlendTime(message.responseDuration!)}
                        </span>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className={`message ${message.role} ${message.isError ? 'error' : ''}`}>
            <div className="message-content">
                {message.displayContent || message.content}
            </div>
        </div>
    );
}
