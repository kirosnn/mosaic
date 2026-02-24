import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useMemo, useState } from "react";
import type { UsageDailyEntry, UsageDailyModelEntry, UsageReport } from "../../utils/usage";

type UsageTab = "overview" | "models" | "daily" | "stats";

interface UsageScreenProps {
  report: UsageReport | null;
  loading: boolean;
  error: string | null;
  terminalWidth: number;
  terminalHeight: number;
  onRefresh: () => void;
  onClose: () => void;
}

interface ChartCell {
  char: string;
  color: string;
}

interface OverviewRow {
  provider: string;
  model: string;
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  conversations: number;
}

type FooterActionId = "scroll" | "tabs" | "refresh" | "back" | "quit";
const ACCENT_COLOR = "#ffca38";
const MODEL_COLOR_PALETTE = [
  "#ffca38",
  "#8fb6ff",
  "#8fc7a4",
  "#f0a35f",
  "#bca8ff",
  "#79cfd0",
  "#e29cb4",
  "#c9c9c9",
];

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function formatCompactTokens(value: number): string {
  const safe = Math.max(0, Math.round(value));
  if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`;
  return `${safe}`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function padEnd(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cycleTab(current: UsageTab, direction: 1 | -1): UsageTab {
  const tabs: UsageTab[] = ["overview", "models", "daily", "stats"];
  const index = tabs.indexOf(current);
  const nextIndex = (index + direction + tabs.length) % tabs.length;
  return tabs[nextIndex] ?? "overview";
}

function buildModelColorMap(rows: OverviewRow[]): Map<string, string> {
  const map = new Map<string, string>();
  rows.forEach((row, index) => {
    map.set(`${row.provider}/${row.model}`, MODEL_COLOR_PALETTE[index % MODEL_COLOR_PALETTE.length] ?? "#c9c9c9");
  });
  return map;
}

function toOverviewRows(report: UsageReport | null): OverviewRow[] {
  if (!report) return [];
  return report.models.map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    costUsd: entry.costUsd,
    totalTokens: entry.totalTokens,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    conversations: entry.conversations,
  }));
}

function getRecentDaily(report: UsageReport | null, maxDays: number): UsageDailyEntry[] {
  if (!report) return [];
  return report.daily.slice(Math.max(0, report.daily.length - maxDays));
}

function toDaySeries(day: UsageDailyEntry, keys: string[]): number[] {
  const map = new Map<string, UsageDailyModelEntry>();
  day.models.forEach((model) => {
    map.set(`${model.provider}/${model.model}`, model);
  });
  return keys.map((key) => map.get(key)?.totalTokens ?? 0);
}

function buildStackedChart(
  days: UsageDailyEntry[],
  keys: string[],
  colorMap: Map<string, string>,
  chartHeight: number
): {
  rows: ChartCell[][];
  maxTokens: number;
} {
  if (days.length === 0 || keys.length === 0 || chartHeight <= 0) {
    return { rows: [], maxTokens: 0 };
  }

  const totals = days.map((day) => day.totalTokens);
  const maxTokens = Math.max(0, ...totals);
  if (maxTokens <= 0) {
    const emptyRows: ChartCell[][] = Array.from({ length: chartHeight }, () =>
      Array.from({ length: days.length }, () => ({ char: "·", color: "#4d4d4d" }))
    );
    return { rows: emptyRows, maxTokens };
  }

  const rows: ChartCell[][] = [];
  for (let row = 0; row < chartHeight; row += 1) {
    const level = chartHeight - row;
    const threshold = (level / chartHeight) * maxTokens;
    const rowCells: ChartCell[] = [];

    for (let col = 0; col < days.length; col += 1) {
      const series = toDaySeries(days[col]!, keys);
      const total = series.reduce((sum, value) => sum + value, 0);
      if (total < threshold) {
        rowCells.push({ char: " ", color: "#4d4d4d" });
        continue;
      }

      let cumulative = 0;
      let color = "#c9c9c9";
      for (let i = 0; i < series.length; i += 1) {
        cumulative += series[i] ?? 0;
        if (cumulative >= threshold) {
          color = colorMap.get(keys[i] ?? "") ?? "#c9c9c9";
          break;
        }
      }

      rowCells.push({ char: "█", color });
    }

    rows.push(rowCells);
  }

  return { rows, maxTokens };
}

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parsed.getMonth()] ?? "?"} ${parsed.getDate()}`;
}

export function UsageScreen(props: UsageScreenProps) {
  const renderer = useRenderer();
  const [tab, setTab] = useState<UsageTab>("overview");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hoveredTab, setHoveredTab] = useState<UsageTab | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredAction, setHoveredAction] = useState<FooterActionId | null>(null);

  const rows = useMemo(() => toOverviewRows(props.report), [props.report]);
  const colorMap = useMemo(() => buildModelColorMap(rows.slice(0, 10)), [rows]);
  const keyList = useMemo(() => rows.slice(0, 6).map((row) => `${row.provider}/${row.model}`), [rows]);

  const chartWidth = clamp(props.terminalWidth - 10, 20, 90);
  const chartHeight = clamp(Math.floor(props.terminalHeight * 0.28), 6, 12);
  const recentDays = useMemo(() => getRecentDaily(props.report, chartWidth), [props.report, chartWidth]);
  const chart = useMemo(() => buildStackedChart(recentDays, keyList, colorMap, chartHeight), [recentDays, keyList, colorMap, chartHeight]);

  const totalCost = props.report?.totals.costUsd ?? 0;
  const totalTokens = props.report?.totals.totalTokens ?? 0;
  const visibleRows = clamp(Math.floor(props.terminalHeight * 0.32), 4, 10);
  const maxOffset = Math.max(0, rows.length - visibleRows);
  const safeOffset = clamp(scrollOffset, 0, maxOffset);
  const windowRows = rows.slice(safeOffset, safeOffset + visibleRows);
  const selectedRow = rows[clamp(selectedIndex, 0, Math.max(0, rows.length - 1))];
  const activeTabs: Array<{ id: UsageTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "models", label: "Models" },
    { id: "daily", label: "Daily" },
    { id: "stats", label: "Stats" },
  ];

  const moveSelection = (direction: 1 | -1) => {
    if (rows.length === 0) return;
    setSelectedIndex((prev) => {
      const next = clamp(prev + direction, 0, Math.max(0, rows.length - 1));
      if (next < safeOffset) {
        setScrollOffset(next);
      } else if (next >= safeOffset + visibleRows) {
        setScrollOffset(clamp(next - visibleRows + 1, 0, maxOffset));
      }
      return next;
    });
  };

  const handleScrollAction = () => {
    if (rows.length === 0) return;
    setSelectedIndex((prev) => {
      const next = prev >= rows.length - 1 ? 0 : prev + 1;
      if (next < safeOffset) {
        setScrollOffset(next);
      } else if (next >= safeOffset + visibleRows) {
        setScrollOffset(clamp(next - visibleRows + 1, 0, maxOffset));
      }
      return next;
    });
  };

  const handleTabsAction = () => {
    setTab((current) => cycleTab(current, 1));
    setSelectedIndex(0);
    setScrollOffset(0);
  };

  useKeyboard((key) => {
    if (key.name === "q") {
      renderer.destroy();
      return;
    }
    if (key.name === "escape") {
      props.onClose();
      return;
    }
    if (key.name === "r") {
      props.onRefresh();
      return;
    }
    if (key.name === "tab" || key.name === "right") {
      setTab((current) => cycleTab(current, 1));
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }
    if (key.name === "left") {
      setTab((current) => cycleTab(current, -1));
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }
    if (key.name === "up") {
      moveSelection(-1);
      return;
    }
    if (key.name === "down") {
      moveSelection(1);
    }
  });

  const renderFooterAction = (id: FooterActionId, keyLabel: string, textLabel: string, onClick?: () => void) => {
    const isHovered = hoveredAction === id;
    const keyAttributes = isHovered ? TextAttributes.BOLD : 0;
    const labelAttributes = TextAttributes.DIM | (isHovered ? TextAttributes.UNDERLINE : 0);
    return (
      <box
        flexDirection="row"
        onMouseOver={() => setHoveredAction(id)}
        onMouseOut={() => setHoveredAction((prev) => (prev === id ? null : prev))}
        onMouseDown={() => onClick?.()}
      >
        <text fg="white" attributes={keyAttributes}>{keyLabel}</text>
        <text fg="white" attributes={labelAttributes}>{` ${textLabel}`}</text>
        <text>{`  `}</text>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <box flexDirection="row">
          {activeTabs.map((item, index) => {
            const isActive = tab === item.id;
            const isHovered = hoveredTab === item.id;
            const attrs = (isActive ? TextAttributes.BOLD : 0) | (isHovered ? TextAttributes.UNDERLINE : 0);
            const tabColor = isActive ? ACCENT_COLOR : isHovered ? "white" : "#9a9a9a";
            return (
              <box
                key={item.id}
                flexDirection="row"
                onMouseOver={() => setHoveredTab(item.id)}
                onMouseOut={() => setHoveredTab((prev) => (prev === item.id ? null : prev))}
                onMouseDown={() => {
                  setTab(item.id);
                  setSelectedIndex(0);
                  setScrollOffset(0);
                }}
              >
                <text fg={tabColor} attributes={attrs}>{item.label}</text>
                {index < activeTabs.length - 1 ? <text fg="#8a8a8a">  </text> : null}
              </box>
            );
          })}
        </box>
        <box flexDirection="row">
          <text fg={ACCENT_COLOR} attributes={TextAttributes.BOLD}>mosaic usage</text>
          <text fg="#8a8a8a"> | local</text>
        </box>
      </box>

      {props.error ? (
        <box flexDirection="row" marginBottom={1}>
          <text fg="white" attributes={TextAttributes.DIM}>Error: {props.error}</text>
        </box>
      ) : null}
      {props.loading ? (
        <box flexDirection="row" marginBottom={1}>
          <text fg="white" attributes={TextAttributes.DIM}>Loading pricing data...</text>
        </box>
      ) : null}

      {!props.report ? (
        <box flexDirection="row" flexGrow={1}>
          <text fg="white" attributes={TextAttributes.DIM}>No usage data available.</text>
        </box>
      ) : tab === "overview" ? (
        <box flexDirection="column" flexGrow={1}>
          <text fg="white" attributes={TextAttributes.BOLD}>Tokens per Day</text>
          <box flexDirection="row">
            <text fg="white" attributes={TextAttributes.DIM}>{padEnd(formatCompactTokens(chart.maxTokens), 8)}</text>
          </box>
          <box flexDirection="column">
            {chart.rows.map((row, rowIndex) => (
              <box key={`chart-row-${rowIndex}`} flexDirection="row">
                <text fg="white" attributes={TextAttributes.DIM}>{rowIndex === chart.rows.length - 1 ? padEnd("0", 8) : "        "}</text>
                {row.map((cell, colIndex) => (
                  <text key={`cell-${rowIndex}-${colIndex}`} fg={cell.color}>{cell.char}</text>
                ))}
              </box>
            ))}
          </box>
          <box flexDirection="row" marginBottom={1}>
            <text fg="white" attributes={TextAttributes.DIM}>{padEnd("", 8)}</text>
            {recentDays.length > 0 ? (
              <>
                <text fg="white" attributes={TextAttributes.DIM}>{dayLabel(recentDays[0]!.date)}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{padEnd("", Math.max(1, Math.floor(Math.max(0, recentDays.length - 2) / 2)))}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{dayLabel(recentDays[Math.floor((recentDays.length - 1) / 2)]!.date)}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{padEnd("", Math.max(1, Math.floor(Math.max(0, recentDays.length - 2) / 2)))}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{dayLabel(recentDays[recentDays.length - 1]!.date)}</text>
              </>
            ) : null}
          </box>

          <box flexDirection="row" marginBottom={1}>
            {keyList.map((key, index) => (
              <box key={`legend-${index}`} flexDirection="row" marginRight={2}>
                <text fg={colorMap.get(key) ?? "#d6d6d6"}>●</text>
                <text fg="white" attributes={TextAttributes.DIM}>{` ${truncate(key, 24)}`}</text>
              </box>
            ))}
          </box>

          <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <text fg="white" attributes={TextAttributes.BOLD}>Models by Cost</text>
            <box flexDirection="row">
              <text fg="white" attributes={TextAttributes.DIM}>Total:</text>
              <text fg={ACCENT_COLOR}>{` ${formatMoney(totalCost)}`}</text>
            </box>
          </box>

          <box flexDirection="column">
            {windowRows.map((row, index) => {
              const absolute = safeOffset + index;
              const isActive = absolute === clamp(selectedIndex, 0, Math.max(0, rows.length - 1));
              const isHovered = hoveredRow === absolute;
              const share = totalCost > 0 ? ((row.costUsd / totalCost) * 100).toFixed(1) : "0.0";
              const head = `${truncate(`${row.provider}/${row.model}`, 48)} (${share}%)`;
              const detail = `In: ${formatInteger(row.promptTokens)} · Out: ${formatInteger(row.completionTokens)} · Total: ${formatInteger(row.totalTokens)} · Cost: ${formatMoney(row.costUsd)}`;
              return (
                <box
                  key={`model-row-${absolute}`}
                  flexDirection="column"
                  onMouseOver={() => setHoveredRow(absolute)}
                  onMouseOut={() => setHoveredRow((prev) => (prev === absolute ? null : prev))}
                  onMouseDown={() => setSelectedIndex(absolute)}
                >
                  <box flexDirection="row">
                    <text fg={isActive ? ACCENT_COLOR : "white"}>{isActive ? "› " : isHovered ? "· " : "  "}</text>
                    <text fg="white" attributes={isActive || isHovered ? TextAttributes.BOLD : 0}>{head}</text>
                  </box>
                  <text fg="white" attributes={TextAttributes.DIM}>{truncate(detail, Math.max(20, props.terminalWidth - 4))}</text>
                </box>
              );
            })}
          </box>
        </box>
      ) : tab === "models" ? (
        <scrollbox
          scrollY
          width="100%"
          height={Math.max(8, props.terminalHeight - 6)}
          verticalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
          horizontalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
        >
          <box flexDirection="column">
            <text fg="white" attributes={TextAttributes.BOLD}>All Models</text>
            {rows.map((row, index) => {
              const share = totalCost > 0 ? ((row.costUsd / totalCost) * 100).toFixed(1) : "0.0";
              const line = `${padEnd(truncate(`${row.provider}/${row.model}`, 52), 52)} ${padEnd(formatMoney(row.costUsd), 10)} ${padEnd(formatCompactTokens(row.totalTokens), 10)} ${padEnd(formatInteger(row.conversations), 6)} ${share}%`;
              return <text key={`all-model-${index}`} fg="white" attributes={TextAttributes.DIM}>{line}</text>;
            })}
          </box>
        </scrollbox>
      ) : tab === "daily" ? (
        <scrollbox
          scrollY
          width="100%"
          height={Math.max(8, props.terminalHeight - 6)}
          verticalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
          horizontalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
        >
          <box flexDirection="column">
            <text fg="white" attributes={TextAttributes.BOLD}>Daily Usage</text>
            {(props.report.daily || []).map((day, index) => {
              const line = `${padEnd(day.date, 14)} ${padEnd(formatCompactTokens(day.totalTokens), 10)} ${padEnd(formatMoney(day.costUsd), 10)} ${padEnd(formatInteger(day.conversations), 6)} conv`;
              return <text key={`daily-${index}`} fg="white" attributes={TextAttributes.DIM}>{line}</text>;
            })}
          </box>
        </scrollbox>
      ) : (
        <scrollbox
          scrollY
          width="100%"
          height={Math.max(8, props.terminalHeight - 6)}
          verticalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
          horizontalScrollbarOptions={{
            showArrows: false,
            trackOptions: {
              backgroundColor: "#111111",
              foregroundColor: "#111111",
            },
          }}
        >
          <box flexDirection="column">
            <text fg="white" attributes={TextAttributes.BOLD}>Statistics</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Conversations: ${formatInteger(props.report.totals.conversations)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Active days: ${formatInteger(props.report.totals.activeDays)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Total tokens: ${formatInteger(props.report.totals.totalTokens)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Prompt tokens: ${formatInteger(props.report.totals.promptTokens)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Completion tokens: ${formatInteger(props.report.totals.completionTokens)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Total cost: ${formatMoney(props.report.totals.costUsd)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Priced conversations: ${formatInteger(props.report.totals.pricedConversations)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Unpriced conversations: ${formatInteger(props.report.totals.unpricedConversations)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Workspaces: ${formatInteger(props.report.workspaces.length)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Providers: ${formatInteger(props.report.providers.length)}`}</text>
            <text fg="white" attributes={TextAttributes.DIM}>{`Models: ${formatInteger(props.report.models.length)}`}</text>
            {selectedRow ? (
              <>
                <text fg="white" attributes={TextAttributes.DIM}> </text>
                <text fg="white" attributes={TextAttributes.BOLD}>Selected Model</text>
                <text fg="white" attributes={TextAttributes.DIM}>{`${selectedRow.provider}/${selectedRow.model}`}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{`Cost: ${formatMoney(selectedRow.costUsd)}`}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{`Tokens: ${formatInteger(selectedRow.totalTokens)}`}</text>
                <text fg="white" attributes={TextAttributes.DIM}>{`Conversations: ${formatInteger(selectedRow.conversations)}`}</text>
              </>
            ) : null}
          </box>
        </scrollbox>
      )}

      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row">
          {renderFooterAction("scroll", "↑↓", "scroll", handleScrollAction)}
          {renderFooterAction("tabs", "←/→", "tabs", handleTabsAction)}
          {renderFooterAction("refresh", "r", "refresh", props.onRefresh)}
          {renderFooterAction("back", "esc", "back", props.onClose)}
          {renderFooterAction("quit", "q", "quit", () => renderer.destroy())}
        </box>
        <box flexDirection="row">
          <text fg="white">{formatInteger(totalTokens)}</text>
          <text fg="white" attributes={TextAttributes.DIM}> tokens </text>
          <text fg="white">{formatMoney(totalCost)}</text>
          <text fg="white" attributes={TextAttributes.DIM}>{` (${rows.length} models)`}</text>
        </box>
      </box>
    </box>
  );
}
