import React, { useEffect, useMemo, useState } from "react";
import type { UsageDailyEntry, UsageDailyModelEntry, UsageReport } from "../types";

interface UsagePanelProps {
  report: UsageReport | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onClose: () => void;
}

interface HeatmapCell {
  key: string;
  date: string;
  inYear: boolean;
  entry: UsageDailyEntry | null;
  intensity: number;
}

interface HeatmapMonthLabel {
  label: string;
  column: number;
}

interface UsageModelAggregate {
  provider: string;
  model: string;
  conversations: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  unknownCostConversations: number;
}

const ACCENT_COLOR = "#ffca38";
const MODEL_COLOR_PALETTE = [
  "#ffca38",
  "#8fb6ff",
  "#8fc7a4",
  "#f0a35f",
  "#bca8ff",
  "#79cfd0",
  "#e29cb4",
  "#bdbdbd",
];

function toDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatCompactTokens(value: number): string {
  const safe = Math.max(0, Math.round(value));
  if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`;
  return `${safe}`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function monthShortName(monthIndex: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Math.max(0, Math.min(11, monthIndex))] ?? "";
}

function buildHeatmap(cellsByDate: Map<string, UsageDailyEntry>, selectedYear: string): {
  cells: HeatmapCell[];
  months: HeatmapMonthLabel[];
  weekCount: number;
} {
  const yearValue = Number(selectedYear);
  if (!Number.isFinite(yearValue) || yearValue < 1970) {
    return { cells: [], months: [], weekCount: 0 };
  }

  const yearStart = new Date(yearValue, 0, 1);
  const yearEnd = new Date(yearValue, 11, 31);
  const gridStart = new Date(yearStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(yearEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const cells: HeatmapCell[] = [];
  const months: HeatmapMonthLabel[] = [];
  const seenMonths = new Set<number>();
  let index = 0;
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const date = toDateKey(cursor);
    const entry = cellsByDate.get(date) ?? null;
    const inYear = cursor >= yearStart && cursor <= yearEnd;
    if (inYear && cursor.getDate() === 1) {
      const month = cursor.getMonth();
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        months.push({ label: monthShortName(month), column: Math.floor(index / 7) });
      }
    }
    cells.push({
      key: `${date}-${index}`,
      date,
      inYear,
      entry,
      intensity: entry ? entry.intensity : 0,
    });
    index += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  const weekCount = Math.ceil(cells.length / 7);
  return { cells, months, weekCount };
}

function aggregateModels(days: UsageDailyEntry[]): UsageModelAggregate[] {
  const byModel = new Map<string, UsageModelAggregate>();
  for (const day of days) {
    for (const modelEntry of day.models) {
      const key = `${modelEntry.provider}::${modelEntry.model}`;
      const current = byModel.get(key) ?? {
        provider: modelEntry.provider,
        model: modelEntry.model,
        conversations: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        unknownCostConversations: 0,
      };
      current.conversations += modelEntry.conversations;
      current.promptTokens += modelEntry.promptTokens;
      current.completionTokens += modelEntry.completionTokens;
      current.totalTokens += modelEntry.totalTokens;
      current.costUsd += modelEntry.costUsd;
      current.unknownCostConversations += modelEntry.unknownCostConversations;
      byModel.set(key, current);
    }
  }
  return Array.from(byModel.values()).sort((a, b) => {
    if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd;
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    const providerCompare = a.provider.localeCompare(b.provider);
    if (providerCompare !== 0) return providerCompare;
    return a.model.localeCompare(b.model);
  });
}

function aggregateProviders(days: UsageDailyEntry[]): Array<{ provider: string; tokens: number; costUsd: number }> {
  const byProvider = new Map<string, { provider: string; tokens: number; costUsd: number }>();
  for (const day of days) {
    for (const model of day.models) {
      const current = byProvider.get(model.provider) ?? {
        provider: model.provider,
        tokens: 0,
        costUsd: 0,
      };
      current.tokens += model.totalTokens;
      current.costUsd += model.costUsd;
      byProvider.set(model.provider, current);
    }
  }
  return Array.from(byProvider.values()).sort((a, b) => {
    if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd;
    if (b.tokens !== a.tokens) return b.tokens - a.tokens;
    return a.provider.localeCompare(b.provider);
  });
}

function aggregateYearTotals(days: UsageDailyEntry[]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  conversations: number;
  activeDays: number;
  pricedConversations: number;
  unpricedConversations: number;
} {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let conversations = 0;
  let activeDays = 0;
  let unpricedConversations = 0;
  for (const day of days) {
    promptTokens += day.promptTokens;
    completionTokens += day.completionTokens;
    totalTokens += day.totalTokens;
    costUsd += day.costUsd;
    conversations += day.conversations;
    unpricedConversations += day.unknownCostConversations;
    if (day.totalTokens > 0) {
      activeDays += 1;
    }
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    conversations,
    activeDays,
    pricedConversations: Math.max(0, conversations - unpricedConversations),
    unpricedConversations,
  };
}

function dayDetailsTitle(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function buildCellTooltip(cell: HeatmapCell): string {
  if (!cell.inYear) return "";
  if (!cell.entry) return `${cell.date}\nNo usage`;
  return `${cell.date}\n${formatInteger(cell.entry.totalTokens)} tokens\n${formatMoney(cell.entry.costUsd)}\n${formatInteger(cell.entry.conversations)} conversations`;
}

function toDayMap(daily: UsageDailyEntry[]): Map<string, UsageDailyEntry> {
  const map = new Map<string, UsageDailyEntry>();
  for (const entry of daily) {
    map.set(entry.date, entry);
  }
  return map;
}

function pickDefaultYear(report: UsageReport | null): string {
  if (!report || report.years.length === 0) return "";
  return report.years[report.years.length - 1]?.year ?? "";
}

function pickDefaultDay(days: UsageDailyEntry[]): string | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (day && day.totalTokens > 0) return day.date;
  }
  return days.length > 0 ? (days[days.length - 1]?.date ?? null) : null;
}

function renderModelLabel(model: UsageDailyModelEntry | UsageModelAggregate): string {
  return `${model.provider} / ${model.model}`;
}

function modelColorKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function hashModelKey(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildModelColorMap(models: UsageModelAggregate[]): Map<string, string> {
  const map = new Map<string, string>();
  models.forEach((model, index) => {
    const color = MODEL_COLOR_PALETTE[index % MODEL_COLOR_PALETTE.length] ?? ACCENT_COLOR;
    map.set(modelColorKey(model.provider, model.model), color);
  });
  return map;
}

function resolveModelColor(provider: string, model: string, colorMap: Map<string, string>): string {
  const key = modelColorKey(provider, model);
  const existing = colorMap.get(key);
  if (existing) return existing;
  const colorIndex = hashModelKey(key) % MODEL_COLOR_PALETTE.length;
  return MODEL_COLOR_PALETTE[colorIndex] ?? ACCENT_COLOR;
}

export function UsagePanel(props: UsagePanelProps) {
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const nextYear = pickDefaultYear(props.report);
    setSelectedYear(nextYear);
  }, [props.report]);

  const dailyByDate = useMemo(() => toDayMap(props.report?.daily ?? []), [props.report]);

  const yearOptions = useMemo(() => {
    return props.report?.years.map((entry) => entry.year) ?? [];
  }, [props.report]);

  const dailyForYear = useMemo(() => {
    if (!props.report || !selectedYear) return [];
    return props.report.daily.filter((entry) => entry.date.startsWith(`${selectedYear}-`));
  }, [props.report, selectedYear]);

  useEffect(() => {
    if (dailyForYear.length === 0) {
      setSelectedDate(null);
      return;
    }
    if (selectedDate && dailyForYear.some((entry) => entry.date === selectedDate)) {
      return;
    }
    setSelectedDate(pickDefaultDay(dailyForYear));
  }, [dailyForYear, selectedDate]);

  const heatmap = useMemo(() => buildHeatmap(dailyByDate, selectedYear), [dailyByDate, selectedYear]);
  const selectedDay = useMemo(() => {
    if (!selectedDate) return null;
    return dailyByDate.get(selectedDate) ?? null;
  }, [dailyByDate, selectedDate]);

  const models = useMemo(() => aggregateModels(dailyForYear), [dailyForYear]);
  const providers = useMemo(() => aggregateProviders(dailyForYear), [dailyForYear]);
  const yearTotals = useMemo(() => aggregateYearTotals(dailyForYear), [dailyForYear]);
  const maxModelTokens = useMemo(() => models.reduce((max, entry) => Math.max(max, entry.totalTokens), 0), [models]);
  const modelColorMap = useMemo(() => buildModelColorMap(models), [models]);

  return (
    <aside className="panel usage-panel">
      <div className="usage-panel-head">
        <div className="usage-panel-title-group">
          <h2>Usage</h2>
          <p className="usage-panel-subtitle">
            {props.report?.scope.includeAllWorkspaces
              ? "Aggregated from all Mosaic workspaces"
              : props.report?.scope.workspace || "Current workspace only"}
          </p>
        </div>
        <div className="usage-panel-actions">
          <button type="button" className="ghost-button tiny-button" onClick={props.onRefresh} disabled={props.loading}>
            {props.loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="ghost-button tiny-button" onClick={props.onClose}>
            Back to chat
          </button>
        </div>
      </div>

      {props.error ? (
        <div className="usage-error">{props.error}</div>
      ) : null}

      {!props.report ? (
        <div className="usage-empty">{props.loading ? "Loading usage report..." : "No usage report available."}</div>
      ) : (
        <>
          <div className="usage-toolbar">
            <label className="usage-year-picker">
              <span>Year</span>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                disabled={yearOptions.length === 0 || props.loading}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <div className="usage-toolbar-meta">
              <span>Range: {props.report.dateRange.start ?? "n/a"} {"->"} {props.report.dateRange.end ?? "n/a"}</span>
              <span>Updated: {new Date(props.report.generatedAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="usage-stats-grid">
            <article className="usage-stat-card usage-stat-card-accent">
              <h3>Total cost</h3>
              <strong>{formatMoney(yearTotals.costUsd)}</strong>
              <p>{formatInteger(yearTotals.pricedConversations)} priced conversations</p>
            </article>
            <article className="usage-stat-card">
              <h3>Total tokens</h3>
              <strong>{formatInteger(yearTotals.totalTokens)}</strong>
              <p>
                prompt {formatCompactTokens(yearTotals.promptTokens)} | completion {formatCompactTokens(yearTotals.completionTokens)}
              </p>
            </article>
            <article className="usage-stat-card">
              <h3>Conversations</h3>
              <strong>{formatInteger(yearTotals.conversations)}</strong>
              <p>{formatInteger(yearTotals.activeDays)} active days</p>
            </article>
            <article className="usage-stat-card">
              <h3>Models</h3>
              <strong>{formatInteger(models.length)}</strong>
              <p>{formatInteger(providers.length)} providers</p>
            </article>
          </div>

          <div className="usage-main-grid">
            <section className="usage-card usage-heatmap-card">
              <header>
                <h3>Daily activity</h3>
                <p>Token intensity per day</p>
              </header>

              <div className="usage-heatmap-months" style={{ gridTemplateColumns: `repeat(${Math.max(1, heatmap.weekCount)}, 1fr)` }}>
                {heatmap.months.map((month) => (
                  <span key={`${month.label}-${month.column}`} style={{ gridColumnStart: month.column + 1 }}>
                    {month.label}
                  </span>
                ))}
              </div>

              <div className="usage-heatmap-body">
                <div className="usage-heatmap-labels">
                  <span>Sun</span>
                  <span>Tue</span>
                  <span>Thu</span>
                  <span>Sat</span>
                </div>
                <div className="usage-heatmap-grid">
                  {heatmap.cells.map((cell) => {
                    const isSelected = Boolean(selectedDate && selectedDate === cell.date);
                    const className = [
                      "usage-heatmap-cell",
                      `intensity-${Math.max(0, Math.min(4, cell.intensity))}`,
                      cell.inYear ? "in-year" : "out-year",
                      isSelected ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        className={className}
                        title={buildCellTooltip(cell)}
                        onClick={() => {
                          if (!cell.inYear) return;
                          setSelectedDate(cell.date);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="usage-heatmap-legend">
                <span>Low</span>
                <div className="usage-legend-cells">
                  <i className="usage-heatmap-cell intensity-0 in-year" />
                  <i className="usage-heatmap-cell intensity-1 in-year" />
                  <i className="usage-heatmap-cell intensity-2 in-year" />
                  <i className="usage-heatmap-cell intensity-3 in-year" />
                  <i className="usage-heatmap-cell intensity-4 in-year" />
                </div>
                <span>High</span>
              </div>
            </section>

            <section className="usage-card usage-models-card">
              <header>
                <h3>Top models</h3>
                <p>Ranked by cost, then tokens</p>
              </header>
              <div className="usage-models-list">
                {models.slice(0, 14).map((model) => {
                  const ratio = maxModelTokens > 0 ? model.totalTokens / maxModelTokens : 0;
                  const modelColor = resolveModelColor(model.provider, model.model, modelColorMap);
                  return (
                    <article
                      key={`${model.provider}::${model.model}`}
                      className="usage-model-row"
                      style={{ ["--usage-model-color" as string]: modelColor } as React.CSSProperties}
                    >
                      <div className="usage-model-main">
                        <div className="usage-model-name">
                          <span className="usage-model-name-dot" style={{ color: modelColor }}>●</span>
                          <span>{renderModelLabel(model)}</span>
                        </div>
                        <div className="usage-model-meta">
                          <span>{formatCompactTokens(model.totalTokens)} tokens</span>
                          <span>{formatMoney(model.costUsd)}</span>
                          <span>{formatInteger(model.conversations)} conv</span>
                        </div>
                      </div>
                      <div className="usage-model-bar">
                        <span style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
                      </div>
                    </article>
                  );
                })}
                {models.length === 0 ? <p className="usage-empty-inline">No models with usage in this year.</p> : null}
              </div>
            </section>
          </div>

          <section className="usage-card usage-breakdown-card">
            <header>
              <h3>Day breakdown</h3>
              <p>{selectedDay ? dayDetailsTitle(selectedDay.date) : "Select a day from the heatmap"}</p>
            </header>
            {selectedDay ? (
              <>
                <div className="usage-breakdown-summary">
                  <span>{formatInteger(selectedDay.totalTokens)} tokens</span>
                  <span>{formatMoney(selectedDay.costUsd)}</span>
                  <span>{formatInteger(selectedDay.conversations)} conversations</span>
                </div>
                <div className="usage-breakdown-list">
                  {selectedDay.models.map((model) => {
                    const modelColor = resolveModelColor(model.provider, model.model, modelColorMap);
                    return (
                      <article
                        key={`${selectedDay.date}-${model.provider}-${model.model}`}
                        className="usage-breakdown-row"
                        style={{ ["--usage-model-color" as string]: modelColor } as React.CSSProperties}
                      >
                        <div className="usage-breakdown-model">
                          <span className="usage-breakdown-model-dot" style={{ color: modelColor }}>●</span>
                          <span>{renderModelLabel(model)}</span>
                        </div>
                        <div className="usage-breakdown-meta">
                          <span>{formatCompactTokens(model.totalTokens)} tokens</span>
                          <span>{formatMoney(model.costUsd)}</span>
                          <span>{formatInteger(model.conversations)} conv</span>
                        </div>
                      </article>
                    );
                  })}
                  {selectedDay.models.length === 0 ? <p className="usage-empty-inline">No model-level data for this day.</p> : null}
                </div>
              </>
            ) : (
              <p className="usage-empty-inline">No day selected.</p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
