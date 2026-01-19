export const BLEND_WORDS = [
  "Blended",
  "Crafted",
  "Brewed",
  "Cooked",
  "Forged",
  "Woven",
  "Composed",
  "Rendered",
  "Conjured",
  "Distilled",
  "Worked"
];

export const THINKING_WORDS = [
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

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "slash";
  displayRole?: "user" | "assistant" | "tool" | "slash";
  displayContent?: string;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
  isError?: boolean;
  responseDuration?: number;
  blendWord?: string;
  thinkingContent?: string;
  isRunning?: boolean;
  runningStartTime?: number;
  timestamp?: number;
}

export interface MainProps {
  pasteRequestId?: number;
  copyRequestId?: number;
  onCopy?: (text: string) => void;
  shortcutsOpen?: boolean;
  commandsOpen?: boolean;
  initialMessage?: string;
}