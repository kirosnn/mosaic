/** @jsxImportSource react */
import React, { useState, useEffect, useRef } from 'react';
import { ApprovalRequest } from '../../utils/approvalBridge';

export type RuleAction = 'auto-run';

interface ApprovalPanelProps {
    request: ApprovalRequest;
    onRespond: (approved: boolean, customResponse?: string, ruleAction?: RuleAction) => void;
}

export function ApprovalPanel({ request, onRespond }: ApprovalPanelProps) {
    const [customText, setCustomText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const isBash = request.toolName === 'bash';
    const bashCommand = isBash ? String(request.args.command ?? '') : '';
    const bashBaseCommand = (() => {
        if (!bashCommand) return '';
        const tokens = bashCommand.trim().split(/\s+/);
        const first = tokens[0];
        if (!first) return '';
        const second = tokens[1];
        if (second && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(second)) {
            return first + ' ' + second;
        }
        return first;
    })();
    const allOptions = isBash
        ? ['Yes', 'Yes, always allow', 'No'] as const
        : ['Yes', 'No'] as const;

    const titleMatch = request.preview.title.match(/^(.+?)\s*\((.+)\)$/);
    const toolName = titleMatch ? titleMatch[1] : request.preview.title;
    const toolInfo = titleMatch ? titleMatch[2] : null;

    useEffect(() => {
        setCustomText('');
        setSelectedIndex(0);
        if (inputRef.current) inputRef.current.focus();
    }, [request.id]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev === 0 ? allOptions.length - 1 : prev - 1));
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev === allOptions.length - 1 ? 0 : prev + 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (customText.trim()) {
                onRespond(false, customText);
            } else {
                const option = allOptions[selectedIndex];
                if (option === 'Yes') onRespond(true);
                else if (option === 'Yes, always allow') onRespond(true, undefined, 'auto-run');
                else onRespond(false);
            }
        }
    };

    const handleSubmitCustom = (e: React.FormEvent) => {
        e.preventDefault();
        onRespond(false, customText);
    };

    const renderDiffLine = (line: string, index: number) => {
        const match = line.match(/^([+-])\s*(\d+)\s*\|?\s*(.*)$/);
        if (match) {
            const [, prefix, lineNum, content] = match;
            const isAdded = prefix === '+';
            const isRemoved = prefix === '-';
            const bgClass = isAdded ? 'diff-added' : isRemoved ? 'diff-removed' : '';

            return (
                <div key={index} className={`diff-line ${bgClass}`}>
                    <span className="diff-linenum">{prefix}{lineNum}</span>
                    <span className="diff-content">{content}</span>
                </div>
            );
        }
        return <div key={index} className="diff-line">{line}</div>;
    };

    return (
        <div className="panel approval-panel">
            <div className="panel-header">
                <strong>{toolName}</strong>
                {toolInfo && <span className="text-muted"> ({toolInfo})</span>}
            </div>
            <div className="panel-content">
                <div className="diff-preview">
                    {request.preview.content.split('\n').map((line, i) => renderDiffLine(line, i))}
                </div>

                <div className="approval-options">
                    {allOptions.map((option, index) => (
                        <div
                            key={option}
                            className={`approval-option ${selectedIndex === index ? 'selected' : ''}`}
                            onClick={() => {
                                if (option === 'Yes') onRespond(true);
                                else if (option === 'Yes, always allow') onRespond(true, undefined, 'auto-run');
                                else onRespond(false);
                            }}
                        >
                            {option}
                            {option === 'Yes, always allow' && bashBaseCommand
                                ? <span className="text-muted"> "{bashBaseCommand}"</span>
                                : null}
                        </div>
                    ))}
                </div>

                <div className="custom-input-container">
                    <form onSubmit={handleSubmitCustom}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={customText}
                            onChange={(e) => setCustomText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="> Tell Mosaic what to do instead..."
                            className="panel-input"
                        />
                    </form>
                </div>
            </div>
            <style>{`
                .panel {
                   background: var(--bg-panel);
                   border: 1px solid var(--border-subtle);
                   border-radius: 8px;
                   margin: 1rem 0;
                   padding: 1rem;
                }
                .panel-header {
                   margin-bottom: 1rem;
                   color: var(--text-primary);
                }
                .text-muted {
                   color: var(--text-muted);
                }
                .diff-preview {
                    font-family: 'Geist Mono', monospace;
                    font-size: 0.9em;
                    background: var(--bg-code);
                    border-radius: 4px;
                    padding: 0.5rem;
                    margin-bottom: 1rem;
                    overflow-x: auto;
                    white-space: pre;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .diff-line {
                    display: flex;
                    min-width: fit-content;
                }
                .diff-added {
                    background: rgba(5, 150, 105, 0.1); 
                }
                .diff-removed {
                    background: rgba(220, 38, 38, 0.1); 
                }
                .diff-linenum {
                    width: 3.5rem;
                    color: var(--text-muted);
                    flex-shrink: 0;
                    user-select: none;
                }
                .diff-content {
                    color: var(--text-primary);
                }
                .approval-options {
                    display: flex;
                    gap: 1rem;
                    margin-bottom: 1rem;
                }
                .approval-option {
                    padding: 0.5rem 1rem;
                    border: 1px solid var(--border-subtle);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                    min-width: 60px;
                    text-align: center;
                }
                .approval-option:hover {
                    background: var(--overlay-light);
                }
                .approval-option.selected {
                    background: var(--overlay-medium);
                    border-color: var(--accent-color);
                    color: var(--accent-color);
                }

                .panel-input {
                    width: 100%;
                    padding: 0.75rem;
                    background: var(--bg-app);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-primary);
                    border-radius: 6px;
                    font-family: inherit;
                }
                .panel-input:focus {
                    outline: none;
                    border-color: var(--accent-color);
                }
            `}</style>
        </div>
    );
}
