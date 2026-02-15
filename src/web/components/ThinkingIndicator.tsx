/** @jsxImportSource react */
import { useState, useEffect, useMemo } from 'react';
import '../assets/css/ThinkingIndicator.css';

const THINKING_WORDS = [
    "Thinking",
    "Processing",
    "Analyzing",
    "Reasoning",
    "Computing",
    "Pondering",
    "Crafting",
    "Working",
    "Brewing",
    "Weaving",
    "Revolutionizing"
];

interface ThinkingIndicatorProps {
    startTime?: number;
    tokens?: number;
    inProgressStep?: string;
    nextStep?: string;
}

function formatElapsedTime(startTime: number | undefined): string {
    if (!startTime) return "";
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
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

export function ThinkingIndicator({ startTime, tokens, nextStep }: ThinkingIndicatorProps) {
    const [shimmerPos, setShimmerPos] = useState(-2);
    const [, setTick] = useState(0);
    const thinkingWord = useMemo(
        () => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)],
        []
    );
    const text = `${thinkingWord}...`;

    useEffect(() => {
        const interval = setInterval(() => {
            setShimmerPos((prev) => {
                const limit = text.length + 20;
                return prev >= limit ? -2 : prev + 1;
            });
            setTick((prev) => prev + 1);
        }, 50);

        return () => clearInterval(interval);
    }, [text.length]);

    const elapsedStr = formatElapsedTime(startTime);

    return (
        <div className="thinking-block">
            <div className="thinking-indicator">
                <span className="thinking-text">
                    {text.split("").map((char, index) => {
                        const inShimmer = index === shimmerPos || index === shimmerPos - 1;
                        return (
                            <span
                                key={index}
                                className={inShimmer ? "shimmer-active" : "shimmer-dim"}
                            >
                                {char}
                            </span>
                        );
                    })}
                </span>
            </div>
        </div>
    );
}