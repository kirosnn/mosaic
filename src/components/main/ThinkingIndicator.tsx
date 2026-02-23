import { useState, useEffect, useRef, useMemo } from "react";
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

type KnightRiderStyle = "blocks" | "diamonds";

interface KnightRiderOptions {
    width?: number;
    style?: KnightRiderStyle;
    holdStart?: number;
    holdEnd?: number;
    colors?: string[];
    defaultColor?: string;
    inactiveChar?: string;
    activeChar?: string;
}

function getScannerState(
    frameIndex: number,
    totalChars: number,
    options: { direction?: "forward" | "backward" | "bidirectional"; holdFrames?: { start?: number; end?: number } },
) {
    const { direction = "forward", holdFrames = {} } = options;

    if (direction === "bidirectional") {
        const forwardFrames = totalChars;
        const holdEndFrames = holdFrames.end ?? 0;
        const backwardFrames = totalChars - 1;

        if (frameIndex < forwardFrames) {
            return {
                activePosition: frameIndex,
                isHolding: false,
                holdProgress: 0,
                holdTotal: 0,
                movementProgress: frameIndex,
                movementTotal: forwardFrames,
                isMovingForward: true,
            };
        } else if (frameIndex < forwardFrames + holdEndFrames) {
            return {
                activePosition: totalChars - 1,
                isHolding: true,
                holdProgress: frameIndex - forwardFrames,
                holdTotal: holdEndFrames,
                movementProgress: 0,
                movementTotal: 0,
                isMovingForward: true,
            };
        } else if (frameIndex < forwardFrames + holdEndFrames + backwardFrames) {
            const backwardIndex = frameIndex - forwardFrames - holdEndFrames;
            return {
                activePosition: totalChars - 2 - backwardIndex,
                isHolding: false,
                holdProgress: 0,
                holdTotal: 0,
                movementProgress: backwardIndex,
                movementTotal: backwardFrames,
                isMovingForward: false,
            };
        } else {
            return {
                activePosition: 0,
                isHolding: true,
                holdProgress: frameIndex - forwardFrames - holdEndFrames - backwardFrames,
                holdTotal: holdFrames.start ?? 0,
                movementProgress: 0,
                movementTotal: 0,
                isMovingForward: false,
            };
        }
    } else if (direction === "backward") {
        return {
            activePosition: totalChars - 1 - (frameIndex % totalChars),
            isHolding: false,
            holdProgress: 0,
            holdTotal: 0,
            movementProgress: frameIndex % totalChars,
            movementTotal: totalChars,
            isMovingForward: false,
        };
    } else {
        return {
            activePosition: frameIndex % totalChars,
            isHolding: false,
            holdProgress: 0,
            holdTotal: 0,
            movementProgress: frameIndex % totalChars,
            movementTotal: totalChars,
            isMovingForward: true,
        };
    }
}

function calculateColorIndex(
    frameIndex: number,
    charIndex: number,
    totalChars: number,
    options: { direction?: "forward" | "backward" | "bidirectional"; holdFrames?: { start?: number; end?: number }; trailLength: number },
): number {
    const { trailLength } = options;
    const { activePosition, isHolding, holdProgress, isMovingForward } = getScannerState(frameIndex, totalChars, options);

    const directionalDistance = isMovingForward ? activePosition - charIndex : charIndex - activePosition;

    if (isHolding) {
        return directionalDistance + holdProgress;
    }

    if (directionalDistance > 0 && directionalDistance < trailLength) {
        return directionalDistance;
    }

    if (directionalDistance === 0) {
        return 0;
    }

    return -1;
}

function createKnightRiderFrames(options: KnightRiderOptions = {}): { frames: string[]; colors: string[]; defaultColor: string } {
    const width = options.width ?? 8;
    const style = options.style ?? "blocks";
    const holdStart = options.holdStart ?? 24;
    const holdEnd = options.holdEnd ?? 7;

    const colors =
        options.colors ??
        [
            "#ffca38",
            "#ffd666",
            "#ffb800",
            "#ff9a3a",
            "#ff7a2f",
        ];

    const defaultColor = options.defaultColor ?? "#2a2320";

    const inactiveChar = options.inactiveChar ?? "▪";
    const activeChar = options.activeChar ?? "■";

    const trailOptions = {
        colors,
        trailLength: colors.length,
        direction: "bidirectional" as const,
        holdFrames: { start: holdStart, end: holdEnd },
    };

    const totalFrames = width + holdEnd + (width - 1) + holdStart;

    const frames = Array.from({ length: totalFrames }, (_, frameIndex) => {
        return Array.from({ length: width }, (_, charIndex) => {
            const index = calculateColorIndex(frameIndex, charIndex, width, trailOptions);

            if (style === "diamonds") {
                const shapes = ["⬥", "◆", "⬩", "⬪"];
                if (index >= 0 && index < colors.length) return shapes[Math.min(index, shapes.length - 1)];
                return inactiveChar;
            }

            const isActive = index >= 0 && index < colors.length;
            return isActive ? activeChar : inactiveChar;
        }).join("");
    });

    return { frames, colors, defaultColor };
}

export function ThinkingIndicator(props: ThinkingIndicatorProps) {
    const [shimmerPos, setShimmerPos] = useState(-2);
    const [animTick, setAnimTick] = useState(0);
    const [thinkingWord] = useState(() => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]);
    const text = `${thinkingWord}...`;

    const tokenTargetRef = useRef(0);
    const displayedTokensRef = useRef(0);
    const flashUntilRef = useRef(0);

    const slider = useMemo(() => {
        return createKnightRiderFrames({
            style: "blocks",
            width: 10,
            holdStart: 20,
            holdEnd: 6,
            inactiveChar: "▪",
            activeChar: "■",
        });
    }, []);

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

            setAnimTick((prev) => prev + 1);
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
    const breakdownStr = breakdownParts.length > 0 ? ` (${breakdownParts.join(" · ")})` : "";

    const sliderFrame = slider.frames[animTick % slider.frames.length] ?? "";
    const trailOptions = {
        trailLength: slider.colors.length,
        direction: "bidirectional" as const,
        holdFrames: { start: 20, end: 6 },
    };

    return (
        <box flexDirection="row" width="100%">
            <box flexDirection="row">
                {sliderFrame.split("").map((char, i) => {
                    const idx = calculateColorIndex(animTick % slider.frames.length, i, sliderFrame.length, trailOptions);
                    const fg = idx >= 0 && idx < slider.colors.length ? slider.colors[idx] : slider.defaultColor;
                    const attributes = idx === 0 ? TextAttributes.BOLD : TextAttributes.DIM;
                    return (
                        <text key={i} fg={fg} attributes={attributes}>
                            {char}
                        </text>
                    );
                })}
                <text attributes={TextAttributes.DIM}> </text>
            </box>

            {text.split("").map((char, index) => {
                const inShimmer = index === shimmerPos || index === shimmerPos - 1;
                return (
                    <text key={index} attributes={inShimmer ? TextAttributes.BOLD : TextAttributes.DIM}>
                        {char}
                    </text>
                );
            })}

            {elapsedStr && <text attributes={TextAttributes.DIM}>{` — ${elapsedStr}`}</text>}
            <text attributes={TextAttributes.DIM}>{" — "}</text>
            <text fg="white">esc</text>
            <text attributes={TextAttributes.DIM}>{" cancel"}</text>
            {displayedTokens > 0 && (
                <>
                    <text attributes={TextAttributes.DIM}>{" — "}</text>
                    <text fg={isFlashing ? "#ffca38" : "white"}>{displayedTokens.toLocaleString()}</text>
                    <text attributes={TextAttributes.DIM}>{` tokens${breakdownStr}`}</text>
                </>
            )}
        </box>
    );
}

export function ThinkingIndicatorBlock(props: ThinkingIndicatorProps) {
    const showIndicator = shouldShowThinkingIndicator(props);
    const [nextShimmerPos, setNextShimmerPos] = useState(-2);
    const nextLabel = "Next :";

    useEffect(() => {
        if (!showIndicator || !props.nextStep) {
            return;
        }

        const interval = setInterval(() => {
            setNextShimmerPos((prev) => {
                const limit = nextLabel.length + 8;
                return prev >= limit ? -2 : prev + 1;
            });
        }, 80);

        return () => clearInterval(interval);
    }, [showIndicator, props.nextStep, nextLabel.length]);

    if (!showIndicator) return null;

    return (
        <box flexDirection="column" width="100%">
            <ThinkingIndicator {...props} />
            {props.nextStep ? (
                <box flexDirection="row" width="100%" paddingLeft={2}>
                    <text fg="#ffca38">{"▪ "}</text>
                    {nextLabel.split("").map((char, index) => {
                        return (
                            <text key={index} fg="#ffca38" attributes={TextAttributes.BOLD}>
                                {char}
                            </text>
                        );
                    })}
                    <text> </text>
                    <text fg="white" attributes={TextAttributes.DIM}>
                        {props.nextStep}
                    </text>
                </box>
            ) : null}
            <box flexDirection="row" width="100%">
                <text> </text>
            </box>
        </box>
    );
}