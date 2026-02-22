import type { Theme } from "./types";

export const THEME_STORAGE_KEY = "mosaic-electron-theme";
export const LOGO_WHITE_SRC = "../../../docs/mosaic_logo_white.png";
export const LOGO_BLACK_SRC = "../../../docs/mosaic_logo_black.png";

export function getThemeLabel(theme: Theme): string {
  return theme === "dark" ? "Obsidian" : "Paper";
}

export function getLogoSrc(theme: Theme): string {
  return theme === "dark" ? LOGO_WHITE_SRC : LOGO_BLACK_SRC;
}
