import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

function showFatalError(message: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const screen = document.createElement("section");
  screen.className = "fatal-screen";

  const card = document.createElement("article");
  card.className = "fatal-screen-card";

  const title = document.createElement("h1");
  title.className = "fatal-screen-title";
  title.textContent = "Renderer error";

  const detail = document.createElement("pre");
  detail.className = "fatal-screen-message";
  detail.textContent = String(message || "Unknown renderer error");

  card.appendChild(title);
  card.appendChild(detail);
  screen.appendChild(card);
  root.appendChild(screen);
}

window.addEventListener("error", (event) => {
  const message = event?.error?.message || event?.message || "Unknown renderer error";
  showFatalError(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  showFatalError(message);
});

if (!window.mosaicDesktop) {
  showFatalError("window.mosaicDesktop is undefined (preload bridge not available).");
  throw new Error("mosaicDesktop bridge not available");
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(<App />);
