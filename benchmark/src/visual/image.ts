import sharp from "sharp";

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 2;
  return Math.max(1, Math.min(6, scale));
}

function parseSvgSize(svg: string): { width: number; height: number } | null {
  const m = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

export async function writePngFromSvg(svg: string, pngPath: string, scale: number): Promise<void> {
  const s = clampScale(scale);
  const size = parseSvgSize(svg);

  let img = sharp(Buffer.from(svg));
  if (size) {
    img = img.resize(Math.round(size.width * s), Math.round(size.height * s), { fit: "fill" });
  }

  await img.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pngPath);
}

