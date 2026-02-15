/** @jsxImportSource react */
import React, { useEffect, useMemo, useState } from 'react';
import { Message } from '../types';
import { parseDiffLine, getDiffLineColors } from '../utils';
import { parseToolHeader } from '../../utils/toolFormatting';
import { getNativeMcpToolName } from '../../mcp/types';

interface ToolOutputProps {
    message: Message;
}

type PlanStatus = 'pending' | 'in_progress' | 'completed';

const COMPACT_TOOLS = new Set(['read', 'list', 'grep', 'glob', 'fetch', 'title', 'question', 'abort', 'review']);

function isCompactTool(toolName: string): boolean {
    if (COMPACT_TOOLS.has(toolName)) return true;
    if (toolName.startsWith('mcp__')) {
        return getNativeMcpToolName(toolName) === 'nativesearch_search';
    }
    return false;
}

function getFirstBodyLine(content: string): string {
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i += 1) {
        const value = (lines[i] || '').trim();
        if (value) return value;
    }
    return '';
}

function getCompactResult(message: Message): string {
    if (message.isRunning) return 'running...';
    const toolName = message.toolName || '';

    if (toolName === 'title') {
        const argsTitle = message.toolArgs && typeof message.toolArgs.title === 'string'
            ? String(message.toolArgs.title)
            : '';
        const resultObj = message.toolResult && typeof message.toolResult === 'object'
            ? (message.toolResult as Record<string, unknown>)
            : null;
        const resultTitle = typeof resultObj?.title === 'string' ? resultObj.title : '';
        const title = (argsTitle || resultTitle).replace(/[\r\n]+/g, ' ').trim();
        return title || 'Completed';
    }

    if (toolName === 'read' && typeof message.toolResult === 'string') {
        const lineCount = message.toolResult ? message.toolResult.split(/\r?\n/).length : 0;
        return `Read ${lineCount} lines`;
    }

    if ((toolName === 'glob' || toolName === 'list') && typeof message.toolResult === 'string') {
        try {
            const parsed = JSON.parse(message.toolResult);
            if (Array.isArray(parsed)) {
                return `${parsed.length} results`;
            }
            if (parsed && typeof parsed === 'object') {
                const files = Array.isArray((parsed as Record<string, unknown>).files)
                    ? (parsed as Record<string, unknown>).files as unknown[]
                    : null;
                if (files) return `${files.length} results`;
            }
        } catch {
        }
    }

    if (toolName === 'question' && message.toolResult && typeof message.toolResult === 'object') {
        const obj = message.toolResult as Record<string, unknown>;
        const customText = typeof obj.customText === 'string' ? obj.customText.trim() : '';
        const label = typeof obj.label === 'string' ? obj.label.trim() : '';
        const value = typeof obj.value === 'string' ? obj.value.trim() : '';
        if (customText) return customText;
        if (label) return label;
        if (value) return value;
        return 'Selected';
    }

    const body = getFirstBodyLine(message.displayContent ?? message.content);
    return body || 'Completed';
}

function getCompactLabel(message: Message): string {
    const toolName = message.toolName || '';
    const args = message.toolArgs || {};

    if (toolName === 'abort' || toolName === 'review') {
        const firstLine = (message.displayContent ?? message.content ?? '').split('\n')[0]?.trim() || 'Interrupted';
        return firstLine;
    }

    const { name, info } = parseToolHeader(toolName, args);
    if (toolName === 'title') return name;
    return info ? `${name} (${info})` : name;
}

function getPlanStatusFromMarker(marker: string): PlanStatus {
    if (marker === '~' || marker === '●') return 'in_progress';
    if (marker === 'x' || marker === '✓') return 'completed';
    return 'pending';
}

function splitToolHeader(line: string): { name: string; info: string | null } {
    const match = line.match(/^(.+?)\s*(\(.*)$/);
    if (match) {
        return { name: match[1] || '', info: match[2] || null };
    }
    return { name: line, info: null };
}

function renderPlanParagraph(line: string, index: number): React.ReactElement {
    const leftPad = index === 0 ? 3 : 3;
    const pad = ' '.repeat(leftPad);
    const trimmed = line || '';
    const match = trimmed.match(/^\[(.)\]\s*(.*)$/);

    if (!match) {
        return (
            <div key={`plan-${index}`} className="tool-line tool-plan-text">
                {`${pad}${trimmed || ' '}`}
            </div>
        );
    }

    const marker = match[1] || ' ';
    const rest = match[2] || '';
    const status = getPlanStatusFromMarker(marker);
    const markerChar = status === 'in_progress' ? '●' : status === 'completed' ? '✓' : ' ';

    return (
        <div key={`plan-${index}`} className="tool-line tool-plan-text">
            <span>{pad}</span>
            <span className="tool-plan-bracket">[</span>
            <span className={`tool-plan-marker ${status}`}>{markerChar}</span>
            <span className="tool-plan-bracket">]</span>
            <span>{rest ? ` ${rest}` : ''}</span>
        </div>
    );
}

function renderBodyParagraph(line: string, index: number, toolName: string): React.ReactElement {
    const content = line.trimStart();

    const planMatch = content.match(/^(\s*)>\s*(\[[~x ]\])?\s*(.*)$/);
    if (planMatch) {
        const [, leading, bracket, rest] = planMatch;
        return (
            <div key={`line-${index}`} className="tool-line tool-plan-branch">
                <span>{leading || ''}</span>
                <span className="tool-plan-branch-prefix">{'>'}</span>
                <span>{' '}</span>
                {bracket ? <span className={`tool-plan-branch-bracket ${bracket === '[~]' ? 'active' : ''}`}>{bracket}</span> : null}
                {bracket ? <span>{' '}</span> : null}
                <span>{rest || ' '}</span>
            </div>
        );
    }

    const parsedDiff = parseDiffLine(content);
    if (parsedDiff.isDiffLine) {
        const colors = getDiffLineColors(parsedDiff);
        const lineNumber = parsedDiff.lineNumber?.padStart(5) || '     ';
        const prefixInset = toolName === 'write' || toolName === 'edit' ? '   ' : '';
        return (
            <div
                key={`line-${index}`}
                className="tool-line tool-diff-line"
                style={{ backgroundColor: colors.contentBackground }}
            >
                {prefixInset ? <span className="tool-diff-prefix">{prefixInset}</span> : null}
                <span className={`tool-diff-sign ${parsedDiff.isAdded ? 'added' : 'removed'}`}>{` ${parsedDiff.prefix}`}</span>
                <span className="tool-diff-number">{lineNumber}</span>
                <span>{' '}</span>
                <span className={`tool-diff-content ${parsedDiff.isAdded ? 'added' : 'removed'}`}>{parsedDiff.content || ''}</span>
            </div>
        );
    }

    return (
        <div key={`line-${index}`} className="tool-line tool-body-line">
            {`  ${content || ' '}`}
        </div>
    );
}

export function ToolOutput({ message }: ToolOutputProps) {
    const toolName = (message.toolName || '').toLowerCase();
    const content = message.displayContent ?? message.content;
    const paragraphs = useMemo(() => content.split('\n'), [content]);
    const [timerTick, setTimerTick] = useState(0);

    useEffect(() => {
        if (!message.isRunning) return undefined;
        const interval = window.setInterval(() => {
            setTimerTick((value) => value + 1);
        }, 500);
        return () => window.clearInterval(interval);
    }, [message.isRunning]);

    if (isCompactTool(toolName)) {
        const label = getCompactLabel(message);
        const result = getCompactResult(message);
        const isRunning = Boolean(message.isRunning);
        const blinkOn = timerTick % 2 === 0;
        const isReview = toolName === 'review';
        const arrowColor = isRunning
            ? (blinkOn ? '#ffffff' : '#808080')
            : isReview ? '#44aa88' : (message.success ? '#44aa88' : '#ff3838');

        return (
            <div className="tool-compact-line">
                <span className="tool-compact-arrow" style={{ color: arrowColor }}>{'➔\u00A0\u00A0'}</span>
                <span className="tool-compact-text">
                    {label}
                    {result ? ` : ${result}` : ''}
                </span>
            </div>
        );
    }

    const runningSeconds = message.runningStartTime
        ? Math.floor((Date.now() - message.runningStartTime) / 1000)
        : 0;
    const showRunningLine = Boolean(message.isRunning && message.runningStartTime && toolName !== 'explore');

    return (
        <div className="message tool">
            <div className="message-content">
                <div className="tool-render">
                    {paragraphs.map((line, index) => {
                        if (toolName === 'plan') {
                            return renderPlanParagraph(line, index);
                        }

                        if (index === 0) {
                            const { name, info } = splitToolHeader(line);
                            if (info) {
                                return (
                                    <div key={`line-${index}`} className="tool-line tool-header-line">
                                        <span>{name} </span>
                                        <span className="tool-header-info">{info}</span>
                                    </div>
                                );
                            }
                            return (
                                <div key={`line-${index}`} className="tool-line tool-header-line">
                                    {name || ' '}
                                </div>
                            );
                        }

                        return renderBodyParagraph(line, index, toolName);
                    })}
                    {showRunningLine ? (
                        <div className="tool-line tool-running-line">
                            {`  Running... ${runningSeconds}s`}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
