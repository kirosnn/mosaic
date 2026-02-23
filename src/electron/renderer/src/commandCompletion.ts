import type { CommandCatalogCommand, CommandCatalogResponse, CommandCatalogSkill } from "./types";

export interface CommandCompletionItem {
  key: string;
  kind: "command" | "skill";
  token: string;
  label: string;
  detail: string;
  score: number;
}

interface ParsedSlashInput {
  prefix: string;
  query: string;
  suffix: string;
}

interface IndexedToken {
  value: string;
  weight: number;
}

interface IndexedItem {
  key: string;
  kind: "command" | "skill";
  token: string;
  label: string;
  detail: string;
  scoreBoost: number;
  minScore: number;
  tokens: IndexedToken[];
}

interface CatalogIndex {
  defaults: CommandCompletionItem[];
  items: IndexedItem[];
}

const catalogIndexCache = new WeakMap<CommandCatalogResponse, CatalogIndex>();

function parseSlashInput(input: string): ParsedSlashInput | null {
  const match = input.match(/^(\s*\/)([^\s]*)([\s\S]*)$/);
  if (!match) return null;
  return {
    prefix: match[1] || "/",
    query: (match[2] || "").toLowerCase(),
    suffix: match[3] || "",
  };
}

function hasArgsSuffix(suffix: string): boolean {
  return /\S/.test(suffix);
}

function subsequenceScore(query: string, target: string): number {
  if (!query || !target) return 0;
  let queryIndex = 0;
  let run = 0;
  let bestRun = 0;
  for (let i = 0; i < target.length; i += 1) {
    if (queryIndex < query.length && target[i] === query[queryIndex]) {
      queryIndex += 1;
      run += 1;
      if (run > bestRun) bestRun = run;
    } else {
      run = 0;
    }
  }
  if (queryIndex < query.length) return 0;
  const contiguity = bestRun / Math.max(1, query.length);
  const closeness = query.length / Math.max(1, target.length);
  return (contiguity * 0.7) + (closeness * 0.3);
}

function fastTokenScore(query: string, token: string): number {
  if (!query) return 0.55;
  if (token === query) return 1;
  if (token.startsWith(query)) {
    const closeness = query.length / Math.max(1, token.length);
    return 0.92 + (closeness * 0.06);
  }
  if (token.includes(query)) {
    return 0.72 + ((query.length / Math.max(1, token.length)) * 0.08);
  }
  return 0;
}

function fullTokenScore(query: string, token: string): number {
  const fast = fastTokenScore(query, token);
  if (fast > 0) return fast;
  return subsequenceScore(query, token) * 0.68;
}

function scoreIndexedTokens(query: string, tokens: IndexedToken[], mode: "fast" | "full"): number {
  if (!query) return 0.55;
  let best = 0;
  for (const token of tokens) {
    const base = mode === "fast" ? fastTokenScore(query, token.value) : fullTokenScore(query, token.value);
    if (base <= 0) continue;
    const weighted = base * token.weight;
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

function trimDetail(value: string, max = 120): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeCommand(command: CommandCatalogCommand): IndexedItem {
  const aliasText = command.aliases.length > 0 ? `aliases: ${command.aliases.join(", ")}` : "";
  const usageText = command.usage ? command.usage : "";
  const detail = trimDetail([command.description, usageText, aliasText].filter(Boolean).join(" · "));
  const tokens: IndexedToken[] = [
    { value: command.name.toLowerCase(), weight: 1 },
    ...command.aliases.map((alias) => ({ value: alias.toLowerCase(), weight: 0.96 })),
  ];

  return {
    key: `command:${command.name}`,
    kind: "command",
    token: command.name,
    label: `/${command.name}`,
    detail,
    scoreBoost: 0.04,
    minScore: 0.45,
    tokens,
  };
}

function normalizeSkill(skill: CommandCatalogSkill): IndexedItem {
  const detail = trimDetail(skill.description || skill.title || "Workspace skill");
  return {
    key: `skill:${skill.id}`,
    kind: "skill",
    token: skill.id,
    label: `/${skill.id}`,
    detail,
    scoreBoost: 0,
    minScore: 0.42,
    tokens: [
      { value: skill.id.toLowerCase(), weight: 1 },
      { value: skill.title.toLowerCase(), weight: 0.85 },
    ],
  };
}

function getCatalogIndex(catalog: CommandCatalogResponse): CatalogIndex {
  const cached = catalogIndexCache.get(catalog);
  if (cached) return cached;

  const commandItems = catalog.commands.map(normalizeCommand);
  const skillItems = catalog.skills.map(normalizeSkill);
  const items = [...commandItems, ...skillItems];

  const defaults: CommandCompletionItem[] = items
    .map((item) => ({
      key: item.key,
      kind: item.kind,
      token: item.token,
      label: item.label,
      detail: item.detail,
      score: item.kind === "command" ? 0.59 : 0.55,
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "command" ? -1 : 1;
      return a.token.localeCompare(b.token);
    });

  const next = {
    defaults,
    items,
  };
  catalogIndexCache.set(catalog, next);
  return next;
}

export function computeCommandCompletions(
  input: string,
  catalog: CommandCatalogResponse | null,
  limit = 10,
): CommandCompletionItem[] {
  if (!catalog) return [];
  const parsed = parseSlashInput(input);
  if (!parsed) return [];
  if (hasArgsSuffix(parsed.suffix)) return [];

  const size = Math.max(1, limit);
  const query = parsed.query;
  const index = getCatalogIndex(catalog);

  if (!query) {
    return index.defaults.slice(0, size);
  }

  const fastMatches: CommandCompletionItem[] = [];
  const missed: IndexedItem[] = [];

  for (const item of index.items) {
    const score = scoreIndexedTokens(query, item.tokens, "fast");
    if (score > 0) {
      fastMatches.push({
        key: item.key,
        kind: item.kind,
        token: item.token,
        label: item.label,
        detail: item.detail,
        score: score + item.scoreBoost,
      });
    } else {
      missed.push(item);
    }
  }

  fastMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === "command" ? -1 : 1;
    return a.token.localeCompare(b.token);
  });

  if (fastMatches.length >= size) {
    return fastMatches.slice(0, size);
  }

  const fallback: CommandCompletionItem[] = [];
  for (const item of missed) {
    const score = scoreIndexedTokens(query, item.tokens, "full");
    if (score < item.minScore) continue;
    fallback.push({
      key: item.key,
      kind: item.kind,
      token: item.token,
      label: item.label,
      detail: item.detail,
      score: score + item.scoreBoost,
    });
  }

  return [...fastMatches, ...fallback]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === "command" ? -1 : 1;
      return a.token.localeCompare(b.token);
    })
    .slice(0, size);
}

export function applyCommandCompletion(input: string, token: string): string {
  const parsed = parseSlashInput(input);
  if (!parsed) return input;
  const normalizedToken = token.trim().replace(/^\//, "");
  if (!normalizedToken) return input;
  const base = `${parsed.prefix}${normalizedToken}`;
  if (parsed.suffix) {
    return `${base}${parsed.suffix}`;
  }
  return `${base} `;
}
