import { resolve } from "path";
import { loadConversations, type ConversationHistory } from "./history";
import { findModelsDevModelById, getModelsDevModel, type ModelsDevModel } from "./models";

const TOKENS_PER_MILLION = 1_000_000;

export type UsageIntensity = 0 | 1 | 2 | 3 | 4;

export interface UsageTokenTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageDailyModelEntry extends UsageTokenTotals {
  provider: string;
  model: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageDailyEntry extends UsageTokenTotals {
  date: string;
  timestampMs: number;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
  intensity: UsageIntensity;
  models: UsageDailyModelEntry[];
}

export interface UsageModelEntry extends UsageTokenTotals {
  provider: string;
  model: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageProviderEntry extends UsageTokenTotals {
  provider: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageWorkspaceEntry extends UsageTokenTotals {
  workspace: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageYearEntry {
  year: string;
  totalTokens: number;
  totalCostUsd: number;
  activeDays: number;
}

export interface UsageTotals extends UsageTokenTotals {
  conversations: number;
  activeDays: number;
  costUsd: number;
  pricedConversations: number;
  unpricedConversations: number;
}

export interface UsageReport {
  generatedAt: string;
  scope: {
    includeAllWorkspaces: boolean;
    workspace: string | null;
  };
  dateRange: {
    start: string | null;
    end: string | null;
  };
  totals: UsageTotals;
  years: UsageYearEntry[];
  daily: UsageDailyEntry[];
  models: UsageModelEntry[];
  providers: UsageProviderEntry[];
  workspaces: UsageWorkspaceEntry[];
}

export interface BuildUsageReportOptions {
  includeAllWorkspaces?: boolean;
  workspace?: string | null;
  refreshPricing?: boolean;
}

interface MutableAggregate extends UsageTokenTotals {
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

interface MutableDailyAggregate extends MutableAggregate {
  date: string;
  timestampMs: number;
  models: Map<string, UsageDailyModelEntry>;
}

interface PricingInfo {
  inputPerMTokens: number | null;
  outputPerMTokens: number | null;
}

function normalizeText(value: unknown, fallback = "unknown"): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || fallback;
}

function normalizeWorkspacePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return resolve(trimmed);
  } catch {
    return trimmed;
  }
}

function toNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

function toNonNegativeInteger(value: unknown): number {
  const numeric = toNumber(value);
  if (numeric <= 0) return 0;
  return Math.round(numeric);
}

function toNonNegativeFloat(value: unknown): number {
  const numeric = toNumber(value);
  return numeric > 0 ? numeric : 0;
}

function getLocalDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTimestamp(value: unknown): number {
  const timestamp = toNumber(value);
  if (timestamp > 0) return Math.round(timestamp);
  return Date.now();
}

function normalizeTokens(conversation: ConversationHistory): UsageTokenTotals {
  const prompt = toNonNegativeInteger(conversation.totalTokens?.prompt);
  const completion = toNonNegativeInteger(conversation.totalTokens?.completion);
  const explicitTotal = toNonNegativeInteger(conversation.totalTokens?.total);
  const sum = prompt + completion;
  const total = explicitTotal > 0 ? Math.max(explicitTotal, sum) : sum;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

function normalizeRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function pricingFromModel(model: ModelsDevModel | null): PricingInfo | null {
  if (!model || !model.cost) return null;
  const inputPerMTokens = normalizeRate(model.cost.input);
  const outputPerMTokens = normalizeRate(model.cost.output);
  if (inputPerMTokens === null && outputPerMTokens === null) {
    return null;
  }
  return {
    inputPerMTokens,
    outputPerMTokens,
  };
}

async function resolvePricing(
  provider: string,
  model: string,
  refreshPricing: boolean,
  cache: Map<string, Promise<PricingInfo | null>>
): Promise<PricingInfo | null> {
  const key = `${provider}::${model}::${refreshPricing ? "1" : "0"}`;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    try {
      const direct = await getModelsDevModel(provider, model, { refresh: refreshPricing });
      const directPricing = pricingFromModel(direct);
      if (directPricing) return directPricing;
    } catch {
    }

    try {
      const byId = await findModelsDevModelById(model, { refresh: refreshPricing });
      const byIdPricing = pricingFromModel(byId?.model ?? null);
      if (byIdPricing) return byIdPricing;
    } catch {
    }

    return null;
  })();

  cache.set(key, task);
  return task;
}

function computeConversationCost(tokens: UsageTokenTotals, pricing: PricingInfo | null): number | null {
  if (!pricing) return null;
  let inputRate = pricing.inputPerMTokens;
  let outputRate = pricing.outputPerMTokens;
  if (inputRate === null && outputRate === null) return null;
  if (inputRate === null) inputRate = outputRate;
  if (outputRate === null) outputRate = inputRate;
  if (inputRate === null || outputRate === null) return null;

  const explicitPrompt = Math.max(0, tokens.promptTokens);
  const explicitCompletion = Math.max(0, tokens.completionTokens);
  const explicitTotal = Math.max(0, tokens.totalTokens);

  let promptTokens = explicitPrompt;
  let completionTokens = explicitCompletion;
  if (explicitTotal > explicitPrompt + explicitCompletion && explicitPrompt + explicitCompletion > 0) {
    const remainder = explicitTotal - (explicitPrompt + explicitCompletion);
    if (completionTokens === 0) {
      completionTokens += remainder;
    } else {
      promptTokens += remainder;
    }
  } else if (explicitTotal > 0 && explicitPrompt + explicitCompletion === 0) {
    promptTokens = explicitTotal;
    completionTokens = 0;
  }

  const cost =
    (promptTokens / TOKENS_PER_MILLION) * inputRate +
    (completionTokens / TOKENS_PER_MILLION) * outputRate;
  return cost >= 0 && Number.isFinite(cost) ? cost : null;
}

function createAggregate(): MutableAggregate {
  return {
    conversations: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unknownCostConversations: 0,
  };
}

function applyAggregate(target: MutableAggregate, tokens: UsageTokenTotals, costUsd: number | null): void {
  target.conversations += 1;
  target.promptTokens += tokens.promptTokens;
  target.completionTokens += tokens.completionTokens;
  target.totalTokens += tokens.totalTokens;
  if (costUsd === null) {
    target.unknownCostConversations += 1;
  } else {
    target.costUsd += costUsd;
  }
}

function quantile(sortedAscending: number[], percent: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.max(0, Math.min(sortedAscending.length - 1, Math.floor((sortedAscending.length - 1) * percent)));
  return sortedAscending[index] ?? 0;
}

function assignIntensities(daily: UsageDailyEntry[]): UsageDailyEntry[] {
  const activeTotals = daily
    .map((entry) => entry.totalTokens)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (activeTotals.length === 0) {
    return daily.map((entry) => ({ ...entry, intensity: 0 }));
  }

  const q1 = quantile(activeTotals, 0.25);
  const q2 = quantile(activeTotals, 0.5);
  const q3 = quantile(activeTotals, 0.75);

  return daily.map((entry) => {
    if (entry.totalTokens <= 0) {
      return { ...entry, intensity: 0 };
    }
    if (entry.totalTokens <= q1) {
      return { ...entry, intensity: 1 };
    }
    if (entry.totalTokens <= q2) {
      return { ...entry, intensity: 2 };
    }
    if (entry.totalTokens <= q3) {
      return { ...entry, intensity: 3 };
    }
    return { ...entry, intensity: 4 };
  });
}

function compareAggregateByCostThenTokens(
  left: { costUsd: number; totalTokens: number },
  right: { costUsd: number; totalTokens: number }
): number {
  if (right.costUsd !== left.costUsd) return right.costUsd - left.costUsd;
  return right.totalTokens - left.totalTokens;
}

export async function buildUsageReport(options: BuildUsageReportOptions = {}): Promise<UsageReport> {
  const includeAllWorkspaces = options.includeAllWorkspaces !== false;
  const workspaceFilter = includeAllWorkspaces
    ? null
    : normalizeWorkspacePath(options.workspace ?? process.cwd());
  const refreshPricing = options.refreshPricing === true;

  const allConversations = loadConversations();
  const conversations = includeAllWorkspaces
    ? allConversations
    : allConversations.filter((conversation) => {
      const workspace = normalizeWorkspacePath(conversation.workspace);
      if (!workspaceFilter) return workspace === null;
      return workspace === workspaceFilter;
    });

  const pricingCache = new Map<string, Promise<PricingInfo | null>>();
  const providerMap = new Map<string, MutableAggregate>();
  const modelMap = new Map<string, UsageModelEntry>();
  const workspaceMap = new Map<string, MutableAggregate>();
  const dayMap = new Map<string, MutableDailyAggregate>();
  const yearMap = new Map<string, UsageYearEntry>();
  const totals = createAggregate();

  for (const conversation of conversations) {
    const provider = normalizeText(conversation.provider);
    const model = normalizeText(conversation.model);
    const workspace = normalizeWorkspacePath(conversation.workspace) ?? "unknown";
    const timestampMs = parseTimestamp(conversation.timestamp);
    const date = getLocalDateKey(timestampMs);
    const year = date.slice(0, 4);
    const tokens = normalizeTokens(conversation);
    const pricing = await resolvePricing(provider, model, refreshPricing, pricingCache);
    const costUsd = computeConversationCost(tokens, pricing);

    applyAggregate(totals, tokens, costUsd);

    const providerAggregate = providerMap.get(provider) ?? createAggregate();
    applyAggregate(providerAggregate, tokens, costUsd);
    providerMap.set(provider, providerAggregate);

    const workspaceAggregate = workspaceMap.get(workspace) ?? createAggregate();
    applyAggregate(workspaceAggregate, tokens, costUsd);
    workspaceMap.set(workspace, workspaceAggregate);

    const modelKey = `${provider}::${model}`;
    const modelEntry = modelMap.get(modelKey) ?? {
      provider,
      model,
      conversations: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unknownCostConversations: 0,
    };
    modelEntry.conversations += 1;
    modelEntry.promptTokens += tokens.promptTokens;
    modelEntry.completionTokens += tokens.completionTokens;
    modelEntry.totalTokens += tokens.totalTokens;
    if (costUsd === null) {
      modelEntry.unknownCostConversations += 1;
    } else {
      modelEntry.costUsd += costUsd;
    }
    modelMap.set(modelKey, modelEntry);

    const dayEntry = dayMap.get(date) ?? {
      date,
      timestampMs: new Date(`${date}T00:00:00`).getTime(),
      conversations: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unknownCostConversations: 0,
      models: new Map<string, UsageDailyModelEntry>(),
    };
    dayEntry.conversations += 1;
    dayEntry.promptTokens += tokens.promptTokens;
    dayEntry.completionTokens += tokens.completionTokens;
    dayEntry.totalTokens += tokens.totalTokens;
    if (costUsd === null) {
      dayEntry.unknownCostConversations += 1;
    } else {
      dayEntry.costUsd += costUsd;
    }
    const dayModel = dayEntry.models.get(modelKey) ?? {
      provider,
      model,
      conversations: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unknownCostConversations: 0,
    };
    dayModel.conversations += 1;
    dayModel.promptTokens += tokens.promptTokens;
    dayModel.completionTokens += tokens.completionTokens;
    dayModel.totalTokens += tokens.totalTokens;
    if (costUsd === null) {
      dayModel.unknownCostConversations += 1;
    } else {
      dayModel.costUsd += costUsd;
    }
    dayEntry.models.set(modelKey, dayModel);
    dayMap.set(date, dayEntry);

    const yearEntry = yearMap.get(year) ?? {
      year,
      totalTokens: 0,
      totalCostUsd: 0,
      activeDays: 0,
    };
    yearEntry.totalTokens += tokens.totalTokens;
    if (costUsd !== null) {
      yearEntry.totalCostUsd += costUsd;
    }
    yearMap.set(year, yearEntry);
  }

  const dailyRaw: UsageDailyEntry[] = Array.from(dayMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      timestampMs: entry.timestampMs,
      conversations: entry.conversations,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
      costUsd: entry.costUsd,
      unknownCostConversations: entry.unknownCostConversations,
      intensity: 0,
      models: Array.from(entry.models.values()).sort((a, b) => {
        const base = compareAggregateByCostThenTokens(a, b);
        if (base !== 0) return base;
        const providerCompare = a.provider.localeCompare(b.provider);
        if (providerCompare !== 0) return providerCompare;
        return a.model.localeCompare(b.model);
      }),
    }));
  const daily = assignIntensities(dailyRaw);

  const activeDaysByYear = new Map<string, number>();
  for (const day of daily) {
    if (day.totalTokens <= 0) continue;
    const year = day.date.slice(0, 4);
    activeDaysByYear.set(year, (activeDaysByYear.get(year) ?? 0) + 1);
  }

  const years: UsageYearEntry[] = Array.from(yearMap.values())
    .map((entry) => ({
      ...entry,
      activeDays: activeDaysByYear.get(entry.year) ?? 0,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const models: UsageModelEntry[] = Array.from(modelMap.values())
    .sort((a, b) => {
      const base = compareAggregateByCostThenTokens(a, b);
      if (base !== 0) return base;
      const providerCompare = a.provider.localeCompare(b.provider);
      if (providerCompare !== 0) return providerCompare;
      return a.model.localeCompare(b.model);
    });

  const providers: UsageProviderEntry[] = Array.from(providerMap.entries())
    .map(([provider, aggregate]) => ({
      provider,
      conversations: aggregate.conversations,
      promptTokens: aggregate.promptTokens,
      completionTokens: aggregate.completionTokens,
      totalTokens: aggregate.totalTokens,
      costUsd: aggregate.costUsd,
      unknownCostConversations: aggregate.unknownCostConversations,
    }))
    .sort((a, b) => {
      const base = compareAggregateByCostThenTokens(a, b);
      if (base !== 0) return base;
      return a.provider.localeCompare(b.provider);
    });

  const workspaces: UsageWorkspaceEntry[] = Array.from(workspaceMap.entries())
    .map(([workspace, aggregate]) => ({
      workspace,
      conversations: aggregate.conversations,
      promptTokens: aggregate.promptTokens,
      completionTokens: aggregate.completionTokens,
      totalTokens: aggregate.totalTokens,
      costUsd: aggregate.costUsd,
      unknownCostConversations: aggregate.unknownCostConversations,
    }))
    .sort((a, b) => {
      const base = compareAggregateByCostThenTokens(a, b);
      if (base !== 0) return base;
      return a.workspace.localeCompare(b.workspace);
    });

  const activeDays = daily.filter((entry) => entry.totalTokens > 0).length;
  const pricedConversations = Math.max(0, totals.conversations - totals.unknownCostConversations);
  const totalsSummary: UsageTotals = {
    conversations: totals.conversations,
    activeDays,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    pricedConversations,
    unpricedConversations: totals.unknownCostConversations,
  };

  const dateRange = {
    start: daily.length > 0 ? daily[0]!.date : null,
    end: daily.length > 0 ? daily[daily.length - 1]!.date : null,
  };

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      includeAllWorkspaces,
      workspace: includeAllWorkspaces ? null : workspaceFilter,
    },
    dateRange,
    totals: totalsSummary,
    years,
    daily,
    models,
    providers,
    workspaces,
  };
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function pad(value: string, length: number): string {
  if (value.length >= length) return value;
  return `${value}${" ".repeat(length - value.length)}`;
}

function buildTokenBar(value: number, maxValue: number, width: number): string {
  if (width <= 0) return "";
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return ".".repeat(width);
  }
  const ratio = Math.max(0, Math.min(1, value / maxValue));
  const filled = Math.max(1, Math.round(ratio * width));
  return `${"#".repeat(filled)}${".".repeat(Math.max(0, width - filled))}`;
}

export interface RenderUsageSummaryOptions {
  maxModels?: number;
  maxRecentDays?: number;
}

export function renderUsageSummary(report: UsageReport, options: RenderUsageSummaryOptions = {}): string {
  const maxModels = options.maxModels && options.maxModels > 0 ? Math.floor(options.maxModels) : 8;
  const maxRecentDays = options.maxRecentDays && options.maxRecentDays > 0 ? Math.floor(options.maxRecentDays) : 14;
  const lines: string[] = [];

  lines.push("Mosaic Usage");
  if (report.scope.includeAllWorkspaces) {
    lines.push("Scope: all workspaces");
  } else {
    lines.push(`Scope: ${report.scope.workspace ?? "unknown workspace"}`);
  }

  if (report.totals.conversations === 0) {
    lines.push("No usage data found in Mosaic history.");
    return lines.join("\n");
  }

  lines.push(`Range: ${report.dateRange.start ?? "n/a"} -> ${report.dateRange.end ?? "n/a"}`);
  lines.push(
    `Totals: ${formatMoney(report.totals.costUsd)} | ${formatInteger(report.totals.totalTokens)} tokens | ${formatInteger(report.totals.conversations)} conversations | ${formatInteger(report.totals.activeDays)} active days`
  );
  lines.push(
    `Tokens split: prompt ${formatInteger(report.totals.promptTokens)} | completion ${formatInteger(report.totals.completionTokens)}`
  );
  if (report.totals.unpricedConversations > 0) {
    lines.push(
      `Pricing coverage: ${formatInteger(report.totals.pricedConversations)} priced, ${formatInteger(report.totals.unpricedConversations)} unpriced conversations`
    );
  }

  lines.push("");
  lines.push("Top models");
  const modelHeader = `${pad("Model", 44)}${pad("Tokens", 12)}${pad("Cost", 11)}Convs`;
  lines.push(modelHeader);
  const topModels = report.models.slice(0, maxModels);
  for (const entry of topModels) {
    const label = truncate(`${entry.provider} / ${entry.model}`, 43);
    lines.push(
      `${pad(label, 44)}${pad(formatCompactTokens(entry.totalTokens), 12)}${pad(formatMoney(entry.costUsd), 11)}${formatInteger(entry.conversations)}`
    );
  }
  if (topModels.length === 0) {
    lines.push("No models found.");
  }

  lines.push("");
  lines.push("Recent days");
  const recentDays = report.daily.slice(Math.max(0, report.daily.length - maxRecentDays));
  const maxDayTokens = recentDays.reduce((max, entry) => Math.max(max, entry.totalTokens), 0);
  for (const day of recentDays) {
    const bar = buildTokenBar(day.totalTokens, maxDayTokens, 20);
    lines.push(
      `${day.date} ${bar} ${pad(formatCompactTokens(day.totalTokens), 8)} ${pad(formatMoney(day.costUsd), 10)} ${formatInteger(day.conversations)} conv`
    );
  }
  if (recentDays.length === 0) {
    lines.push("No daily usage found.");
  }

  return lines.join("\n");
}
