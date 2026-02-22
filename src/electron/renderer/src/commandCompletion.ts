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

function scoreToken(query: string, token: string): number {
  if (!query) return 0.55;
  if (token === query) return 1;
  if (token.startsWith(query)) {
    const closeness = query.length / Math.max(1, token.length);
    return 0.92 + (closeness * 0.06);
  }
  if (token.includes(query)) {
    return 0.72 + ((query.length / Math.max(1, token.length)) * 0.08);
  }
  return subsequenceScore(query, token) * 0.68;
}

function scoreCommand(query: string, command: CommandCatalogCommand): number {
  const base = scoreToken(query, command.name.toLowerCase());
  const aliasScores = command.aliases.map((alias) => scoreToken(query, alias.toLowerCase()));
  const aliasBest = aliasScores.length > 0 ? Math.max(...aliasScores) : 0;
  return Math.max(base, aliasBest * 0.96);
}

function scoreSkill(query: string, skill: CommandCatalogSkill): number {
  const idScore = scoreToken(query, skill.id.toLowerCase());
  const titleScore = scoreToken(query, skill.title.toLowerCase()) * 0.85;
  return Math.max(idScore, titleScore);
}

function trimDetail(value: string, max = 120): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
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

  const query = parsed.query;
  const commandItems: CommandCompletionItem[] = [];
  for (const command of catalog.commands) {
    const score = scoreCommand(query, command);
    if (query && score < 0.45) continue;
    const aliasText = command.aliases.length > 0 ? `aliases: ${command.aliases.join(", ")}` : "";
    const usageText = command.usage ? command.usage : "";
    const detail = trimDetail([command.description, usageText, aliasText].filter(Boolean).join(" · "));
    commandItems.push({
      key: `command:${command.name}`,
      kind: "command",
      token: command.name,
      label: `/${command.name}`,
      detail,
      score: score + 0.04,
    });
  }

  const skillItems: CommandCompletionItem[] = [];
  for (const skill of catalog.skills) {
    const score = scoreSkill(query, skill);
    if (query && score < 0.42) continue;
    const detail = trimDetail(skill.description || skill.title || "Workspace skill");
    skillItems.push({
      key: `skill:${skill.id}`,
      kind: "skill",
      token: skill.id,
      label: `/${skill.id}`,
      detail,
      score,
    });
  }

  return [...commandItems, ...skillItems]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === "command" ? -1 : 1;
      return a.token.localeCompare(b.token);
    })
    .slice(0, Math.max(1, limit));
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
