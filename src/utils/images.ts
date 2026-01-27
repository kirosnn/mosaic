export type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  size: number;
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff"
};

export function guessImageMimeType(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const idx = clean.lastIndexOf(".");
  if (idx === -1) return "application/octet-stream";
  const ext = clean.slice(idx + 1);
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

export function toDataUrl(image: ImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}
