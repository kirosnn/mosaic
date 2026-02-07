import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

interface BashRules {
  autoRun: string[];
  disallowRun: string[];
}

interface LocalRules {
  bash?: Partial<BashRules>;
}

interface CachedRules {
  rules: LocalRules | null;
  mtime: number;
  path: string;
}

let cache: CachedRules | null = null;

function loadLocalBashRules(): LocalRules | null {
  const rulesPath = join(process.cwd(), '.mosaic', 'rules.json');

  try {
    const currentMtime = statSync(rulesPath).mtimeMs;

    if (cache && cache.path === rulesPath && cache.mtime === currentMtime) {
      return cache.rules;
    }

    const content = readFileSync(rulesPath, 'utf-8');
    const rules = JSON.parse(content) as LocalRules;

    cache = { rules, mtime: currentMtime, path: rulesPath };
    return rules;
  } catch {
    if (cache && cache.path === rulesPath) {
      cache = null;
    }
    return null;
  }
}

function matchesBashRule(command: string, patterns: string[]): boolean {
  const trimmed = command.trim();

  for (const pattern of patterns) {
    if (pattern.endsWith(' *')) {
      const prefix = pattern.slice(0, -2);
      if (trimmed === prefix || trimmed.startsWith(prefix + ' ')) {
        return true;
      }
    } else if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (trimmed.startsWith(prefix)) {
        return true;
      }
    } else {
      if (trimmed === pattern) {
        return true;
      }
    }
  }

  return false;
}

function getRulesPath(): string {
  return join(process.cwd(), '.mosaic', 'rules.json');
}

function readRulesFile(): LocalRules {
  const rulesPath = getRulesPath();
  try {
    const content = readFileSync(rulesPath, 'utf-8');
    return JSON.parse(content) as LocalRules;
  } catch {
    return {};
  }
}

function writeRulesFile(rules: LocalRules): void {
  const rulesPath = getRulesPath();
  const dir = join(process.cwd(), '.mosaic');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(rulesPath, JSON.stringify(rules, null, 2), 'utf-8');
  cache = null;
}

export function getBaseCommand(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const first = tokens[0];
  if (!first) return command.trim();
  const second = tokens[1];
  if (second && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(second)) {
    return first + ' ' + second;
  }
  return first;
}

export function addAutoRunRule(command: string): void {
  const rules = readRulesFile();
  if (!rules.bash) rules.bash = {};
  if (!rules.bash.autoRun) rules.bash.autoRun = [];
  const base = getBaseCommand(command);
  const pattern = base + ' *';
  if (!rules.bash.autoRun.includes(pattern)) {
    rules.bash.autoRun.push(pattern);
  }
  writeRulesFile(rules);
}

export function removeAutoRunRule(command: string): void {
  const rules = readRulesFile();
  if (!rules.bash?.autoRun) return;
  const trimmed = command.trim();
  rules.bash.autoRun = rules.bash.autoRun.filter(r => r !== trimmed);
  writeRulesFile(rules);
}

export function getLocalBashDecision(command: string): 'auto-run' | 'disallow' | null {
  const rules = loadLocalBashRules();
  if (!rules?.bash) return null;

  const disallowPatterns = rules.bash.disallowRun ?? [];
  if (disallowPatterns.length > 0 && matchesBashRule(command, disallowPatterns)) {
    return 'disallow';
  }

  const autoRunPatterns = rules.bash.autoRun ?? [];
  if (autoRunPatterns.length > 0 && matchesBashRule(command, autoRunPatterns)) {
    return 'auto-run';
  }

  return null;
}