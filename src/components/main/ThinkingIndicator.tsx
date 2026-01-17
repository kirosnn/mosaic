import React, { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { THINKING_WORDS } from "./types";

interface ThinkingIndicatorProps {
    isProcessing: boolean;
    hasQuestion: boolean;
    startTime?: number | null;
    tokens?: number;
}

export function getInputBarBaseLines(): number {
    return 3;
}

export function getInputAreaTotalLines(): number {
    return getInputBarBaseLines() + 1;
}

export function shouldShowThinkingIndicator({ isProcessing, hasQuestion }: ThinkingIndicatorProps): boolean {
    return isProcessing && !hasQuestion;
}

export function getBottomReservedLinesForInputBar(props: ThinkingIndicatorProps): number {
    return getInputBarBaseLines() + (shouldShowThinkingIndicator(props) ? 2 : 0) + 2;
}

export function formatElapsedTime(ms: number | null | undefined, fromStartTime: boolean = true): string {
    if (!ms) return "";
    const elapsed = fromStartTime ? Math.floor((Date.now() - ms) / 1000) : Math.floor(ms / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

export function ThinkingIndicator(props: ThinkingIndicatorProps) {
    const [shimmerPos, setShimmerPos] = useState(-2);
    const [, setTick] = useState(0);
    const [thinkingWord] = useState(() => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]);
    const text = `${thinkingWord}...`;

    useEffect(() => {
        if (!shouldShowThinkingIndicator(props)) {
            return;
        }

        const interval = setInterval(() => {
            setShimmerPos((prev) => {
                const limit = text.length + 20;
                return prev >= limit ? -2 : prev + 1;
            });
            setTick((prev) => prev + 1);
        }, 50);

        return () => clearInterval(interval);
    }, [props, text.length]);

    if (!shouldShowThinkingIndicator(props)) return null;

    const elapsedStr = formatElapsedTime(props.startTime, true);

    return (
        <box flexDirection="row" width="100%">
            <text fg="#ffca38" attributes={TextAttributes.BOLD}>⁘ </text>
            {text.split("").map((char, index) => {
                const inShimmer = index === shimmerPos || index === shimmerPos - 1;
                return (
                    <text
                        key={index}
                        attributes={inShimmer ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {char}
                    </text>
                );
            })}
            {elapsedStr && <text attributes={TextAttributes.DIM}> — {elapsedStr}</text>}
            <text attributes={TextAttributes.DIM}> — esc to cancel</text>
            {props.tokens !== undefined && props.tokens > 0 && <text attributes={TextAttributes.DIM}> — {props.tokens.toLocaleString()} tokens</text>}
        </box>
    );
}

export function ThinkingIndicatorBlock(props: ThinkingIndicatorProps) {
    if (!shouldShowThinkingIndicator(props)) return null;

    return (
        <box flexDirection="column" width="100%">
            <ThinkingIndicator {...props} />
            <box flexDirection="row" width="100%">
                <text> </text>
            </box>
        </box>
    );
}