import type { Theme } from "./types";

export const THEME_STORAGE_KEY = "mosaic-electron-theme";
export const LOGO_WHITE_SRC = "../../../docs/logo_white.svg";
export const LOGO_BLACK_SRC = "../../../docs/logo_black.svg";

export function getThemeLabel(theme: Theme): string {
  return theme === "dark" ? "Obsidian" : "Paper";
}

export function getLogoSrc(theme: Theme): string {
  return theme === "dark" ? LOGO_WHITE_SRC : LOGO_BLACK_SRC;
}
