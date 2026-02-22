export type MediaKind = "image" | "video" | null;

const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jfif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "avi",
  "flv",
  "m2ts",
  "m2v",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mts",
  "ogv",
  "ts",
  "webm",
  "wmv",
]);

function getExtension(filePath: string): string {
  const value = (filePath || "").trim().toLowerCase();
  if (!value) return "";
  const lastSlash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const filename = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1);
}

export function getMediaKind(filePath: string): MediaKind {
  const extension = getExtension(filePath);
  if (!extension) return null;
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}
