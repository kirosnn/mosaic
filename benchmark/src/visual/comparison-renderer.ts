import type { Theme } from "./themes.js";
import { escXml } from "./card-renderer.js";
import type { BenchmarkReport } from "../types.js";

export interface ModelEntry {
  report: BenchmarkReport;
  logoSvgInner: string | null;
  logoViewBox: string | null;
  displayProvider: string;
  displayModel: string;
  color: string;
}

const MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace`;

const MODEL_COLORS = ["#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899"];

export function assignColors(entries: ModelEntry[]): void {
  for (let i = 0; i < entries.length; i++) {
    entries[i].color = MODEL_COLORS[i % MODEL_COLORS.length];
  }
}

export function renderComparison(entries: ModelEntry[], theme: Theme): string {
  const count = entries.length;
  const barWidth = Math.min(64, Math.max(24, Math.floor(320 / count)));
  const barGap = Math.min(40, Math.max(12, Math.floor(200 / count)));
  const chartW = count * barWidth + (count - 1) * barGap;

  const PAD = 60;
  const W = Math.max(800, chartW + PAD * 2 + 100);
  const headerH = 100;
  const chartAreaTop = headerH + 20;
  const maxBarH = 380;
  const chartAreaBottom = chartAreaTop + maxBarH;
  const labelZoneH = 90;
  const footerH = 48;
  const H = chartAreaBottom + labelZoneH + footerH;

  const barFill = theme.name === "dark" ? "#71717a" : "#a1a1aa";

  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  renderDefs(parts, theme);
  parts.push(`<rect width="${W}" height="${H}" fill="${theme.bg}"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#grid)" opacity="${theme.name === "dark" ? "0.25" : "0.15"}"/>`);
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${theme.border}" stroke-width="1"/>`);

  parts.push(`<text x="${W / 2}" y="44" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="3" fill="${theme.textMuted}">MOSAIC BENCHMARK</text>`);
  parts.push(`<text x="${W / 2}" y="76" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="900" fill="${theme.text}">Overall Comparison</text>`);
  parts.push(`<line x1="0" y1="${headerH}" x2="${W}" y2="${headerH}" stroke="${theme.border}" stroke-width="1"/>`);

  const chartLeft = (W - chartW) / 2;

  renderYAxis(parts, theme, chartLeft - 16, chartAreaTop, maxBarH, chartLeft, chartW);

  parts.push(`<line x1="${chartLeft}" y1="${chartAreaBottom}" x2="${chartLeft + chartW}" y2="${chartAreaBottom}" stroke="${theme.border}" stroke-width="1"/>`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const score = entry.report.overall;
    const barH = (maxBarH * score) / 100;
    const bx = chartLeft + i * (barWidth + barGap);
    const by = chartAreaBottom - barH;

    const barId = `bar-clip-${i}`;
    parts.push(`<clipPath id="${barId}"><rect x="${bx}" y="${chartAreaTop}" width="${barWidth}" height="${maxBarH}"/></clipPath>`);
    parts.push(`<rect x="${bx}" y="${chartAreaTop}" width="${barWidth}" height="${maxBarH}" fill="${theme.subtle}" />`);
    parts.push(`<rect x="${bx}" y="${by}" width="${barWidth}" height="${barH}" fill="${barFill}" clip-path="url(#${barId})"/>`);

    const labelX = bx + barWidth / 2;
    const labelY = chartAreaBottom + 28;

    const logoSize = 16;
    if (entry.logoSvgInner && entry.logoViewBox) {
      const vb = entry.logoViewBox.split(/\s+/).map(Number);
      const vbW = vb[2] ?? logoSize;
      const vbH = vb[3] ?? logoSize;
      const scale = Math.min(logoSize / vbW, logoSize / vbH);
      const offsetX = (logoSize - vbW * scale) / 2;
      const offsetY = (logoSize - vbH * scale) / 2;
      parts.push(`<g transform="translate(${labelX - logoSize / 2 + offsetX}, ${labelY - 12 + offsetY}) scale(${scale.toFixed(4)})">`);
      parts.push(entry.logoSvgInner);
      parts.push("</g>");
    }

    const fontSize = barWidth >= 40 ? 11 : 9;
    parts.push(`<text x="${labelX}" y="${labelY + 16}" text-anchor="middle" font-family="${MONO}" font-size="${fontSize}" font-weight="800" fill="${theme.text}">${escXml(ellipsize(entry.displayModel, 18))}</text>`);
    parts.push(`<text x="${labelX}" y="${labelY + 32}" text-anchor="middle" font-family="${MONO}" font-size="${Math.max(8, fontSize - 2)}" fill="${theme.textMuted}">${escXml(entry.displayProvider)}</text>`);
  }

  const footerLineY = H - footerH;
  parts.push(`<line x1="0" y1="${footerLineY}" x2="${W}" y2="${footerLineY}" stroke="${theme.border}" stroke-width="1"/>`);

  const footerTextY = footerLineY + (footerH / 2) + 4;
  const date = new Date().toISOString().split("T")[0];
  const version = entries[0]?.report.version ?? "1.0.0";
  parts.push(`<text x="${PAD}" y="${footerTextY}" font-family="${MONO}" font-size="11" fill="${theme.textFaint}">${escXml(`mosaic-bench v${version}`)}</text>`);
  parts.push(`<text x="${W - PAD}" y="${footerTextY}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${theme.textFaint}">${escXml(date)}</text>`);

  parts.push("</svg>");
  return parts.join("\n");
}

function renderDefs(parts: string[], theme: Theme): void {
  const gridStroke = theme.border;
  const gridOpacity = theme.name === "dark" ? 0.07 : 0.06;
  const dotOpacity = theme.name === "dark" ? 0.10 : 0.08;

  parts.push("<defs>");
  parts.push(
    `<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">` +
    `<path d="M 48 0 L 0 0 0 48" fill="none" stroke="${gridStroke}" stroke-opacity="${gridOpacity}" stroke-width="1"/>` +
    `<circle cx="0" cy="0" r="1.2" fill="${gridStroke}" fill-opacity="${dotOpacity}"/>` +
    `</pattern>`,
  );
  parts.push("</defs>");
}

function renderYAxis(parts: string[], theme: Theme, rightEdge: number, top: number, height: number, chartLeft: number, chartW: number): void {
  const ticks = [25, 50, 75, 100];
  for (const tick of ticks) {
    const y = top + height - (height * tick) / 100;
    parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartW}" y2="${y}" stroke="${theme.border}" stroke-width="1" stroke-dasharray="4 4" opacity="0.35"/>`);
    parts.push(`<text x="${rightEdge}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${theme.textFaint}">${tick}</text>`);
  }
}

function ellipsize(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return s.slice(0, maxChars);
  return s.slice(0, Math.max(0, maxChars - 3)) + "...";
}
