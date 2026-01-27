/** @jsxImportSource react */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { toDataUrl } from '../../utils/images';
import { parseDiffLine, getDiffLineColors } from '../utils';
import '../assets/css/global.css'

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

function renderToolLine(line: string, index: number): React.ReactElement {
    const parsed = parseDiffLine(line);
    if (parsed.isDiffLine) {
        return renderDiffLine(line, index);
    }

    const planMatch = line.match(/^(\s*)>\s*(\[[~x ]\])?\s*(.*)$/);
    if (planMatch) {
        const [, leading, bracket, rest] = planMatch;
        const isActive = bracket === '[~]';
        return (
            <div key={index} className="tool-line plan-line">
                <span className="plan-indent">{leading || ''}</span>
                <span className="plan-prefix">></span>
                <span> </span>
                {bracket && <span className={`plan-bracket${isActive ? ' active' : ''}`}>{bracket}</span>}
                {bracket && <span> </span>}
                <span className="plan-step">{rest}</span>
            </div>
        );
    }

    return (
        <div key={index} className="tool-line">
            {line}
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
        const planClass = message.toolName === 'plan' ? 'plan-tool' : '';

        const { name, info, bodyLines } = parseToolHeader(message.content);

        return (
            <div className={`message tool ${statusClass} ${planClass}`}>
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
                            {bodyLines.map((line, index) => renderToolLine(line, index))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (message.role === 'assistant') {
        return (
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
                                    const { ref, ...rest } = props as any;
                                    return match ? (
                                        <SyntaxHighlighter
                                            style={vscDarkPlus as any}
                                            language={match[1]}
                                            PreTag="div"
                                            {...rest}
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
        );
    }

    const hasImages = Array.isArray(message.images) && message.images.length > 0;

    return (
        <div className={`message ${message.role} ${message.isError ? 'error' : ''}`}>
            <div className="message-content">
                {hasImages && (
                    <div className="message-images">
                        {message.images!.map((img) => (
                            <img key={img.id} src={toDataUrl(img)} alt={img.name} />
                        ))}
                    </div>
                )}
                <div className="message-text">
                    {message.displayContent || message.content}
                </div>
            </div>
        </div>
    );
}
