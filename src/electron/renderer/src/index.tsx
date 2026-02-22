import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

function showFatalError(message: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const container = document.createElement("div");
  container.style.padding = "24px";
  container.style.fontFamily = "Consolas, monospace";
  container.style.color = "#b91c1c";
  container.textContent = `Renderer error: ${message}`;
  root.appendChild(container);
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
