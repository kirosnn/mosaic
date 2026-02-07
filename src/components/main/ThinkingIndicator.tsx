import { useState, useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { THINKING_WORDS, type TokenBreakdown } from "./types";

interface ThinkingIndicatorProps {
    isProcessing: boolean;
    hasQuestion: boolean;
    startTime?: number | null;
    tokens?: number;
    tokenBreakdown?: TokenBreakdown;
    inProgressStep?: string;
    nextStep?: string;
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
    const indicatorLines = shouldShowThinkingIndicator(props) ? (props.nextStep ? 3 : 2) : 0;
    return getInputBarBaseLines() + indicatorLines + 2;
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
    const [thinkingWord] = useState(
        () => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]
    );
    const text = `${thinkingWord}...`;

    const tokenTargetRef = useRef(0);
    const displayedTokensRef = useRef(0);
    const flashUntilRef = useRef(0);

    useEffect(() => {
        const target = props.tokens ?? 0;
        if (target === 0) {
            tokenTargetRef.current = 0;
            displayedTokensRef.current = 0;
            return;
        }
        if (target > tokenTargetRef.current) {
            if (tokenTargetRef.current > 0) {
                flashUntilRef.current = Date.now() + 400;
            }
            tokenTargetRef.current = target;
        }
    }, [props.tokens]);

    useEffect(() => {
        if (!shouldShowThinkingIndicator(props)) {
            return;
        }

        const interval = setInterval(() => {
            setShimmerPos((prev) => {
                const limit = text.length + 20;
                return prev >= limit ? -2 : prev + 1;
            });

            const target = tokenTargetRef.current;
            const prev = displayedTokensRef.current;
            if (prev < target) {
                const diff = target - prev;
                const step = Math.max(1, Math.ceil(diff / 6));
                const next = Math.min(prev + step, target);
                displayedTokensRef.current = next;
            }

            setTick((prev) => prev + 1);
        }, 50);

        return () => clearInterval(interval);
    }, [props.isProcessing, props.hasQuestion, text.length]);

    if (!shouldShowThinkingIndicator(props)) return null;

    const elapsedStr = formatElapsedTime(props.startTime, true);
    const displayedTokens = displayedTokensRef.current;
    const isFlashing = Date.now() < flashUntilRef.current;

    const bd = props.tokenBreakdown;
    const breakdownParts: string[] = [];
    if (bd && bd.prompt > 0) breakdownParts.push(`prompt ${bd.prompt.toLocaleString()}`);
    if (bd && bd.reasoning > 0) breakdownParts.push(`reasoning ${bd.reasoning.toLocaleString()}`);
    if (bd && bd.tools > 0) breakdownParts.push(`tools ${bd.tools.toLocaleString()}`);
    if (bd && bd.output > 0) breakdownParts.push(`output ${bd.output.toLocaleString()}`);
    const breakdownStr = breakdownParts.length > 0 ? ` (${breakdownParts.join(' · ')})` : '';

    return (
        <box flexDirection="row" width="100%">
            <text fg="#ffca38" attributes={TextAttributes.BOLD}>{'⁘ '}</text>
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
            {elapsedStr && <text attributes={TextAttributes.DIM}>{` — ${elapsedStr}`}</text>}
            <text attributes={TextAttributes.DIM}>{' — '}</text>
            <text fg="white">esc</text>
            <text attributes={TextAttributes.DIM}>{' cancel'}</text>
            {displayedTokens > 0 && (
                <>
                    <text attributes={TextAttributes.DIM}>{' — '}</text>
                    <text fg={isFlashing ? "#ffca38" : "white"}>{displayedTokens.toLocaleString()}</text>
                    <text attributes={TextAttributes.DIM}>{` tokens${breakdownStr}`}</text>
                </>
            )}
        </box>
    );
}

export function ThinkingIndicatorBlock(props: ThinkingIndicatorProps) {
    if (!shouldShowThinkingIndicator(props)) return null;

    return (
        <box flexDirection="column" width="100%">
            <ThinkingIndicator {...props} />
            {props.nextStep ? (
                <box flexDirection="row" width="100%" paddingLeft={2}>
                    <text fg="#ffca38">{'➔ '}</text>
                    <text fg="#ffca38" attributes={TextAttributes.BOLD}>Next:</text>
                    <text> </text>
                    <text fg="white" attributes={TextAttributes.DIM}>{props.nextStep}</text>
                </box>
            ) : null}
            <box flexDirection="row" width="100%">
                <text> </text>
            </box>
        </box>
    );
}
