import React, { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";

interface ThinkingIndicatorProps {
    isProcessing: boolean;
    hasQuestion: boolean;
}

export function getInputBarBaseLines(): number {
    return 3;
}

export function shouldShowThinkingIndicator({ isProcessing, hasQuestion }: ThinkingIndicatorProps): boolean {
    return isProcessing && !hasQuestion;
}

export function getBottomReservedLinesForInputBar(props: ThinkingIndicatorProps): number {
    return getInputBarBaseLines() + (shouldShowThinkingIndicator(props) ? 2 : 0);
}

export function ThinkingIndicator(props: ThinkingIndicatorProps) {
    const [shimmerPos, setShimmerPos] = useState(-2);
    const text = "Thinking...";

    useEffect(() => {
        if (!shouldShowThinkingIndicator(props)) {
            return;
        }

        const interval = setInterval(() => {
            setShimmerPos((prev) => {
                const limit = text.length + 20;
                return prev >= limit ? -2 : prev + 1;
            });
        }, 50);

        return () => clearInterval(interval);
    }, [props, text.length]);

    if (!shouldShowThinkingIndicator(props)) return null;

    return (
        <box flexDirection="row" width="100%">
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
            <text attributes={TextAttributes.DIM}> — esc to cancel</text>
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