export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  success?: boolean;
  isError?: boolean;
}

export interface MainProps {
  pasteRequestId?: number;
  copyRequestId?: number;
  onCopy?: (text: string) => void;
  shortcutsOpen?: boolean;
}
