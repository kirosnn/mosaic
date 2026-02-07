import type { Theme } from "./themes.js";
import { SUITE_WEIGHTS } from "../scoring/weights.js";
import type { BenchmarkReport } from "../types.js";

export interface CardData {
  report: BenchmarkReport;
  logoSvgInner: string | null;
  logoViewBox: string | null;
  displayProvider: string;
  displayModel: string;
}

const W = 900;
const H = 1000;
const PAD = 60;
const CONTENT_W = W - PAD * 2;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace`;

export function renderCard(data: CardData, theme: Theme): string {
  const { report } = data;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  renderDefs(parts, theme);
  parts.push(`<rect width="${W}" height="${H}" fill="${theme.bg}"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#grid)" opacity="${theme.name === "dark" ? "0.25" : "0.15"}"/>`);
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${theme.border}" stroke-width="1"/>`);

  let y = PAD;

  y = renderHeader(parts, data, theme, y);
  y = renderOverall(parts, report.overall, theme, y);
  y = renderMetrics(parts, report, theme, y);
  y = renderSuites(parts, report, theme, y);
  y = renderPerformance(parts, report, theme, y);
  renderFooter(parts, report, theme);

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

function renderHeader(parts: string[], data: CardData, theme: Theme, y: number): number {
  const cx = W / 2;

  parts.push(`<text x="${cx}" y="${y + 14}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="3" fill="${theme.textMuted}">MOSAIC BENCHMARK</text>`);

  const logoSize = 48;
  const logoY = y + 36;

  if (data.logoSvgInner && data.logoViewBox) {
    const vb = data.logoViewBox.split(/\s+/).map(Number);
    const vbW = vb[2] ?? logoSize;
    const vbH = vb[3] ?? logoSize;
    const scale = Math.min(logoSize / vbW, logoSize / vbH);
    const offsetX = (logoSize - vbW * scale) / 2;
    const offsetY = (logoSize - vbH * scale) / 2;
    parts.push(`<g transform="translate(${cx - logoSize / 2 + offsetX}, ${logoY + offsetY}) scale(${scale.toFixed(4)})">`);
    parts.push(data.logoSvgInner);
    parts.push("</g>");
  } else {
    const initial = data.displayProvider.charAt(0).toUpperCase();
    parts.push(`<rect x="${cx - logoSize / 2}" y="${logoY}" width="${logoSize}" height="${logoSize}" fill="${theme.subtle}" />`);
    parts.push(`<text x="${cx}" y="${logoY + logoSize / 2 + 8}" text-anchor="middle" font-family="${MONO}" font-size="22" font-weight="700" fill="${theme.text}">${escXml(initial)}</text>`);
  }

  const textY = logoY + logoSize + 28;
  parts.push(`<text x="${cx}" y="${textY}" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="900" fill="${theme.text}">${escXml(data.displayModel)}</text>`);

  const modelId = `${data.report.provider}/${data.report.model}`;
  parts.push(`<text x="${cx}" y="${textY + 22}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${theme.textMuted}">${escXml(`${data.displayProvider}  ·  ${modelId}`)}</text>`);

  const separatorY = textY + 44;
  parts.push(`<line x1="0" y1="${separatorY}" x2="${W}" y2="${separatorY}" stroke="${theme.border}" stroke-width="1"/>`);

  return separatorY + 24;
}

function renderOverall(parts: string[], overall: number, theme: Theme, y: number): number {
  const cx = W / 2;
  parts.push(`<text x="${cx}" y="${y + 52}" text-anchor="middle" font-family="${MONO}" font-size="72" font-weight="900" fill="${theme.text}">${overall}</text>`);
  parts.push(`<text x="${cx}" y="${y + 78}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2.4" fill="${theme.textMuted}">OVERALL</text>`);
  return y + 110;
}

function renderMetrics(parts: string[], report: BenchmarkReport, theme: Theme, y: number): number {
  const barFill = theme.name === "dark" ? "#71717a" : "#a1a1aa";
  y = renderBar(parts, "Capability", report.capability, PAD, y, CONTENT_W, 24, barFill, theme);
  y += 16;
  y = renderBar(parts, "Reliability", report.reliability, PAD, y, CONTENT_W, 24, barFill, theme);
  return y + 24;
}

function renderSuites(parts: string[], report: BenchmarkReport, theme: Theme, y: number): number {
  const barFill = theme.name === "dark" ? "#71717a" : "#a1a1aa";

  parts.push(`<line x1="${PAD}" y1="${y - 8}" x2="${W - PAD}" y2="${y - 8}" stroke="${theme.border}" stroke-width="1"/>`);
  parts.push(`<text x="${PAD}" y="${y + 14}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2.4" fill="${theme.textMuted}">SUITES</text>`);
  y += 40;

  for (const suite of report.suites) {
    const weight = SUITE_WEIGHTS[suite.suite] ?? 0;
    const label = `${formatSuiteName(suite.suite)} (${weight}%)`;
    y = renderBar(parts, label, suite.score, PAD, y, CONTENT_W, 20, barFill, theme);
    y += 14;
  }

  return y;
}

function renderPerformance(parts: string[], report: BenchmarkReport, theme: Theme, y: number): number {
  parts.push(`<line x1="${PAD}" y1="${y - 8}" x2="${W - PAD}" y2="${y - 8}" stroke="${theme.border}" stroke-width="1"/>`);
  parts.push(`<text x="${PAD}" y="${y + 14}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2.4" fill="${theme.textMuted}">PERFORMANCE</text>`);
  y += 42;

  const col2 = W / 2;
  parts.push(`<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="13" fill="${theme.textMuted}">TTFT <tspan font-weight="800" fill="${theme.text}">${report.performance.ttftMs}ms</tspan></text>`);
  parts.push(`<text x="${col2}" y="${y}" font-family="${MONO}" font-size="13" fill="${theme.textMuted}">Throughput <tspan font-weight="800" fill="${theme.text}">${report.performance.charsPerSecond} chars/s</tspan></text>`);

  return y + 24;
}

function renderFooter(parts: string[], report: BenchmarkReport, theme: Theme): void {
  const footerH = 48;
  const footerLineY = H - footerH;
  parts.push(`<line x1="0" y1="${footerLineY}" x2="${W}" y2="${footerLineY}" stroke="${theme.border}" stroke-width="1"/>`);

  const footerTextY = footerLineY + (footerH / 2) + 4;
  const date = report.timestamp.split("T")[0] ?? report.timestamp;
  parts.push(`<text x="${PAD}" y="${footerTextY}" font-family="${MONO}" font-size="11" fill="${theme.textFaint}">${escXml(`mosaic-bench v${report.version}  ·  ${report.runs} runs`)}</text>`);
  parts.push(`<text x="${W - PAD}" y="${footerTextY}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${theme.textFaint}">${escXml(date)}</text>`);
}

function renderBar(
  parts: string[],
  label: string,
  score: number,
  x: number,
  y: number,
  totalWidth: number,
  barHeight: number,
  barFill: string,
  theme: Theme,
): number {
  const labelWidth = 200;
  const scoreWidth = 52;
  const gap = 12;
  const barWidth = totalWidth - labelWidth - scoreWidth - gap;
  const barX = x + labelWidth;
  const barY = y - barHeight / 2 + 4;

  parts.push(`<text x="${x}" y="${y + 5}" font-family="${MONO}" font-size="13" font-weight="700" fill="${theme.text}">${escXml(label)}</text>`);

  parts.push(`<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="${theme.subtle}" />`);
  const fillW = Math.max(0, (barWidth * score) / 100);
  if (fillW > 0) {
    parts.push(`<rect x="${barX}" y="${barY}" width="${fillW}" height="${barHeight}" fill="${barFill}" />`);
  }
  parts.push(`<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="none" stroke="${theme.border}" stroke-width="1"/>`);

  parts.push(`<text x="${x + totalWidth}" y="${y + 5}" text-anchor="end" font-family="${MONO}" font-size="13" font-weight="900" fill="${theme.text}">${score}%</text>`);

  return y + barHeight + 4;
}

export function formatSuiteName(suite: string): string {
  return suite
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
