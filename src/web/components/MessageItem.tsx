/** @jsxImportSource react */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { toDataUrl } from '../../utils/images';
import '../assets/css/global.css';
import { ToolOutput } from './ToolOutput';

interface MessageItemProps {
    message: Message;
}

const linkSchemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function normalizeLinkUri(href: string) {
    const trimmed = href.trim();
    if (!trimmed) return trimmed;
    if (linkSchemePattern.test(trimmed)) return trimmed;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.') || trimmed.startsWith('?')) return trimmed;
    return `https://${trimmed}`;
}

function handleMarkdownLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href?: string | null) {
    if (!href) return;
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
}

export function MessageItem({ message }: MessageItemProps) {
    if (message.role === 'tool') {
        return <ToolOutput message={message} />;
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
                                a({ href, children, ...props }) {
                                    const normalized = normalizeLinkUri(href || '');
                                    return (
                                        <a
                                            href={normalized}
                                            onClick={(event) => handleMarkdownLinkClick(event, normalized)}
                                            {...props}
                                        >
                                            {children}
                                        </a>
                                    );
                                },
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
