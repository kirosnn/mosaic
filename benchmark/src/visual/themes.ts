export interface Theme {
  name: "light" | "dark";
  bg: string;
  fg: string;
  subtle: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  success: string;
  info: string;
  warning: string;
  error: string;
}

export const LIGHT: Theme = {
  name: "light",
  bg: "#ffffff",
  fg: "#fcfcfc",
  subtle: "#f4f4f5",
  border: "#e4e4e7",
  text: "#18181b",
  textMuted: "#71717a",
  textFaint: "#a1a1aa",
  accent: "#18181b",
  success: "#10b981",
  info: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
};

export const DARK: Theme = {
  name: "dark",
  bg: "#09090b",
  fg: "#18181b",
  subtle: "#27272a",
  border: "#3f3f46",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  textFaint: "#52525b",
  accent: "#fafafa",
  success: "#10b981",
  info: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
};

export function scoreColor(score: number, theme: Theme): string {
  if (score >= 90) return theme.success;
  if (score >= 70) return theme.info;
  if (score >= 50) return theme.warning;
  return theme.error;
}
