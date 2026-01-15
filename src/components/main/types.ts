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
  role: "user" | "assistant" | "tool";
  displayRole?: "user" | "assistant" | "tool";
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
}