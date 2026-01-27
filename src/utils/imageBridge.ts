import type { ImageAttachment } from "./images";

export type ImageCommandEvent =
  | { type: "add"; image: ImageAttachment }
  | { type: "clear" }
  | { type: "remove"; id: string };

const listeners = new Set<(event: ImageCommandEvent) => void>();
let imageSupport = false;

export function subscribeImageCommand(listener: (event: ImageCommandEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitImageCommand(event: ImageCommandEvent): void {
  listeners.forEach((listener) => listener(event));
}

export function setImageSupport(enabled: boolean): void {
  imageSupport = enabled;
}

export function canUseImages(): boolean {
  return imageSupport;
}
