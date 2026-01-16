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
];

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "slash";
  displayRole?: "user" | "assistant" | "tool" | "slash";
  displayContent?: string;
  content: string;
  toolName?: string;
  success?: boolean;
  isError?: boolean;
  responseDuration?: number;
  blendWord?: string;
}

export interface MainProps {
  pasteRequestId?: number;
  copyRequestId?: number;
  onCopy?: (text: string) => void;
  shortcutsOpen?: boolean;
  commandsOpen?: boolean;
  initialMessage?: string;
}