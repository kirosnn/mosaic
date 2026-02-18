import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { detectProject } from './detector.js';
import { buildCategoryBreakdown, calculateScore } from './scoring.js';
import type { Diagnostic, DoctorResult, ProjectInfo, ReactFramework } from './types.js';

const require = createRequire(import.meta.url);

interface ReactDoctorScoreResult {
  score: number;
  label: string;
}

interface ReactDoctorProjectInfo {
  rootDirectory: string;
  projectName: string;
  reactVersion: string | null;
  framework: 'nextjs' | 'vite' | 'cra' | 'remix' | 'gatsby' | 'unknown';
  hasTypeScript: boolean;
  hasReactCompiler: boolean;
  sourceFileCount: number;
}

interface ReactDoctorDiagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
}

interface ReactDoctorResult {
  diagnostics: ReactDoctorDiagnostic[];
  score: ReactDoctorScoreResult | null;
  project: ReactDoctorProjectInfo;
  elapsedMilliseconds: number;
}

interface ReactDoctorApiModule {
  diagnose: (
    directory: string,
    options?: { lint?: boolean; deadCode?: boolean },
  ) => Promise<ReactDoctorResult>;
}

const LEGACY_CATEGORY_ALIASES: Record<string, string[]> = {
  bugs: ['correctness', 'other'],
  security: ['security'],
  correctness: ['correctness'],
  architecture: ['architecture'],
  performance: ['performance'],
  'state-effects': ['state-effects'],
  nextjs: ['nextjs'],
  client: ['correctness', 'performance', 'accessibility'],
  server: ['server'],
  'bundle-size': ['bundle-size'],
  'js-performance': ['performance'],
  'react-native': ['correctness', 'performance'],
  project: ['dead-code', 'react-compiler', 'other'],
};

function normalizeCategory(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'other';
  if (normalized === 'state & effects' || normalized === 'state and effects') return 'state-effects';
  if (normalized === 'bundle size') return 'bundle-size';
  if (normalized === 'react compiler') return 'react-compiler';
  if (normalized === 'dead code') return 'dead-code';
  if (normalized === 'next.js') return 'nextjs';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}

function mapFramework(value: string): ReactFramework {
  if (value === 'nextjs') return 'nextjs';
  if (value === 'vite') return 'vite';
  if (value === 'cra') return 'cra';
  if (value === 'remix') return 'remix';
  if (value === 'gatsby') return 'gatsby';
  return 'unknown';
}

function mapStatusFromLabel(
  label: string | undefined,
  score: number | undefined,
  fallback: 'good' | 'ok' | 'poor',
): 'good' | 'ok' | 'poor' {
  const normalized = (label || '').toLowerCase();
  if (normalized.includes('great')) return 'good';
  if (normalized.includes('excellent')) return 'good';
  if (normalized.includes('good')) return 'good';
  if (normalized.includes('ok')) return 'ok';
  if (normalized.includes('okay')) return 'ok';
  if (normalized.includes('poor')) return 'poor';
  if (typeof score === 'number') {
    if (score >= 80) return 'good';
    if (score >= 60) return 'ok';
    return 'poor';
  }
  return fallback;
}

function toRelativeFilePath(filePath: string, rootDir: string): string {
  const absRoot = resolve(rootDir);
  const absPath = resolve(rootDir, filePath);
  if (absPath.startsWith(absRoot)) {
    return absPath.slice(absRoot.length).replace(/^[\\/]/, '');
  }
  return filePath.replace(/\\/g, '/');
}

function buildCategoryFilter(input?: string[]): Set<string> | null {
  if (!input || input.length === 0) return null;
  const out = new Set<string>();
  for (const value of input) {
    const normalized = normalizeCategory(value);
    out.add(normalized);
    const aliases = LEGACY_CATEGORY_ALIASES[normalized];
    if (aliases) {
      for (const alias of aliases) out.add(alias);
    }
  }
  return out;
}

function toDiagnostic(entry: ReactDoctorDiagnostic, rootDir: string): Diagnostic {
  const rule = entry.plugin ? `${entry.plugin}/${entry.rule}` : entry.rule;
  return {
    filePath: toRelativeFilePath(entry.filePath, rootDir),
    line: Math.max(1, entry.line || 1),
    column: Math.max(1, entry.column || 1),
    rule,
    severity: entry.severity,
    message: entry.message,
    help: entry.help,
    category: normalizeCategory(entry.category),
  };
}

async function runReactDoctor(
  directory: string,
  options: { lint?: boolean; deadCode?: boolean },
): Promise<ReactDoctorResult> {
  try {
    const mod = await import('react-doctor/api') as unknown as ReactDoctorApiModule;
    return await mod.diagnose(directory, options);
  } catch (importError) {
    try {
      return await runReactDoctorViaNode(directory, options);
    } catch (nodeError) {
      const first = importError instanceof Error ? importError.message : String(importError);
      const second = nodeError instanceof Error ? nodeError.message : String(nodeError);
      throw new Error(`API import failed (${first}); Node fallback failed (${second})`);
    }
  }
}

async function runReactDoctorViaNode(
  directory: string,
  options: { lint?: boolean; deadCode?: boolean },
): Promise<ReactDoctorResult> {
  const payload = JSON.stringify({ directory, options });
  const script = [
    "import { diagnose } from 'react-doctor/api';",
    'const payload = JSON.parse(process.argv[1] || "{}");',
    'const result = await diagnose(payload.directory, payload.options || {});',
    'process.stdout.write(JSON.stringify(result));',
  ].join('');

  return await new Promise<ReactDoctorResult>((resolvePromise, rejectPromise) => {
    const child = spawn('node', ['--input-type=module', '-e', script, payload], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      rejectPromise(error);
    });
    child.on('close', code => {
      if (code !== 0) {
        const detail = stderr.trim() || `node exited with code ${code}`;
        rejectPromise(new Error(detail));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as ReactDoctorResult;
        resolvePromise(parsed);
      } catch {
        const preview = stdout.trim().slice(0, 300);
        rejectPromise(new Error(`Invalid React Doctor JSON output: ${preview}`));
      }
    });
  });
}

function resolveProjectInfo(
  rootDir: string,
  reactDoctorProject: ReactDoctorProjectInfo,
): ProjectInfo {
  const detected = detectProject(rootDir, reactDoctorProject.sourceFileCount, []);
  const framework = mapFramework(reactDoctorProject.framework);
  const frameworks = framework === 'unknown'
    ? detected.frameworks
    : Array.from(new Set<ReactFramework>([framework, ...detected.frameworks]));

  return {
    ...detected,
    reactVersion: reactDoctorProject.reactVersion ?? detected.reactVersion,
    framework,
    frameworks,
    hasReactCompiler: reactDoctorProject.hasReactCompiler,
    sourceFileCount: reactDoctorProject.sourceFileCount || detected.sourceFileCount,
    directory: rootDir,
  };
}

function getReactDoctorPackageMeta(): { version: string | null; distIndexPath: string | null } {
  try {
    const distIndexPath = require.resolve('react-doctor/dist/index.js');
    const packageJsonPath = join(dirname(distIndexPath), '..', 'package.json');
    if (!existsSync(packageJsonPath)) {
      return { version: null, distIndexPath };
    }
    const raw = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    const version = typeof raw.version === 'string' ? raw.version : null;
    return { version, distIndexPath };
  } catch {
    return { version: null, distIndexPath: null };
  }
}

function getReactDoctorRuleCatalog(): Array<{
  id: string;
  category: string;
  severity: 'error' | 'warning';
  frameworks: 'all' | string[];
}> {
  try {
    const { distIndexPath } = getReactDoctorPackageMeta();
    if (!distIndexPath || !existsSync(distIndexPath)) return [];
    const content = readFileSync(distIndexPath, 'utf-8');

    const severityMap = new Map<string, 'error' | 'warning'>();
    const severityRegex = /"react-doctor\/([^"]+)":\s*"(error|warn)"/g;
    let sm: RegExpExecArray | null;
    while ((sm = severityRegex.exec(content)) !== null) {
      const id = sm[1];
      const sev = sm[2] === 'error' ? 'error' : 'warning';
      if (id) severityMap.set(id, sev);
    }

    const categoryMap = new Map<string, string>();
    const categoryRegex = /"react-doctor\/([^"]+)":\s*"([^"]+)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = categoryRegex.exec(content)) !== null) {
      const id = cm[1];
      const category = cm[2];
      if (id && category) categoryMap.set(id, normalizeCategory(category));
    }

    const ids = new Set<string>([...severityMap.keys(), ...categoryMap.keys()]);
    const catalog = Array.from(ids).map(id => ({
      id: `react-doctor/${id}`,
      category: categoryMap.get(id) ?? 'other',
      severity: severityMap.get(id) ?? 'warning',
      frameworks: id.startsWith('nextjs-') ? ['nextjs'] : ('all' as const),
    }));

    catalog.sort((a, b) => a.id.localeCompare(b.id));
    return catalog;
  } catch {
    return [];
  }
}

function filterDiagnostics(
  diagnostics: Diagnostic[],
  categoryFilter: Set<string> | null,
  includeWarnings: boolean,
): Diagnostic[] {
  return diagnostics.filter(diagnostic => {
    if (!includeWarnings && diagnostic.severity === 'warning') return false;
    if (categoryFilter && !categoryFilter.has(diagnostic.category)) return false;
    return true;
  });
}

function sortDiagnostics(diagnostics: Diagnostic[]): void {
  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1;
    }
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}

function countUniqueFiles(diagnostics: Diagnostic[]): number {
  return new Set(diagnostics.map(d => d.filePath)).size;
}

function normalizePathForCompare(value: string): string {
  return resolve(value).replace(/\\/g, '/').toLowerCase();
}

export function registerTools(server: McpServer): void {
  server.registerTool('nativereact_doctor', {
    description:
      'Run React Doctor directly on a React project and return a normalized diagnostic report for the agent.',
    inputSchema: {
      directory: z.string().describe('Absolute path to the React project root directory'),
      categories: z
        .array(z.string())
        .optional()
        .describe('Optional category filter. Supports React Doctor categories and legacy aliases.'),
      maxDiagnostics: z
        .number()
        .optional()
        .describe('Maximum number of diagnostics to return (default: 150)'),
      includeWarnings: z
        .boolean()
        .optional()
        .describe('Include warnings in results (default: true)'),
      analysisMode: z
        .enum(['smart', 'full'])
        .optional()
        .describe('smart: lint-only scan (default). full: lint + dead-code scan.'),
      lint: z
        .boolean()
        .optional()
        .describe('Override lint execution for React Doctor.'),
      deadCode: z
        .boolean()
        .optional()
        .describe('Override dead-code execution for React Doctor.'),
    },
  }, async (args) => {
    const rootDir = resolve(args.directory);
    const maxDiagnostics = args.maxDiagnostics ?? 150;
    const includeWarnings = args.includeWarnings ?? true;
    const analysisMode = args.analysisMode ?? 'smart';
    const lint = args.lint ?? true;
    const deadCode = args.deadCode ?? (analysisMode === 'full');
    const categoryFilter = buildCategoryFilter(args.categories);

    let doctorResult: ReactDoctorResult;
    try {
      doctorResult = await runReactDoctor(rootDir, { lint, deadCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `React Doctor failed: ${message}`,
            source: 'react-doctor',
          }, null, 2),
        }],
        isError: true,
      };
    }

    const mappedDiagnostics = doctorResult.diagnostics.map(entry => toDiagnostic(entry, rootDir));
    const filteredDiagnostics = filterDiagnostics(mappedDiagnostics, categoryFilter, includeWarnings);
    sortDiagnostics(filteredDiagnostics);

    const truncated = filteredDiagnostics.length > maxDiagnostics;
    const shownDiagnostics = filteredDiagnostics.slice(0, maxDiagnostics);
    const projectInfo = resolveProjectInfo(rootDir, doctorResult.project);
    const fallbackScore = calculateScore(filteredDiagnostics, Math.max(projectInfo.sourceFileCount, 1));
    const score = doctorResult.score?.score ?? fallbackScore.score;
    const status = mapStatusFromLabel(doctorResult.score?.label, doctorResult.score?.score, fallbackScore.status);
    const fileCount = projectInfo.sourceFileCount > 0
      ? projectInfo.sourceFileCount
      : Math.max(countUniqueFiles(filteredDiagnostics), 1);

    const result: DoctorResult & {
      truncated?: boolean;
      totalDiagnostics?: number;
      source: 'react-doctor';
      scoreSource: 'react-doctor' | 'fallback';
      elapsedMilliseconds: number;
      lint: boolean;
      deadCode: boolean;
      reactDoctorLabel: string | null;
    } = {
      score,
      status,
      projectInfo,
      diagnostics: shownDiagnostics,
      fileCount,
      scannedFileCount: fileCount,
      skippedFileCount: 0,
      analysisMode,
      errorCount: filteredDiagnostics.filter(d => d.severity === 'error').length,
      warningCount: filteredDiagnostics.filter(d => d.severity === 'warning').length,
      categoryBreakdown: buildCategoryBreakdown(filteredDiagnostics),
      source: 'react-doctor',
      scoreSource: doctorResult.score ? 'react-doctor' : 'fallback',
      elapsedMilliseconds: doctorResult.elapsedMilliseconds,
      lint,
      deadCode,
      reactDoctorLabel: doctorResult.score?.label ?? null,
    };

    if (truncated) {
      result.truncated = true;
      result.totalDiagnostics = filteredDiagnostics.length;
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });

  server.registerTool('nativereact_analyze_file', {
    description:
      'Run React Doctor on the project and return diagnostics for a single file.',
    inputSchema: {
      filePath: z.string().describe('Absolute path to the React file to analyze'),
      projectRoot: z
        .string()
        .optional()
        .describe('Absolute path to the project root. Defaults to the file directory.'),
      categories: z
        .array(z.string())
        .optional()
        .describe('Optional category filter. Supports React Doctor categories and legacy aliases.'),
      includeWarnings: z
        .boolean()
        .optional()
        .describe('Include warnings in results (default: true)'),
      analysisMode: z
        .enum(['smart', 'full'])
        .optional()
        .describe('smart: lint-only scan (default). full: lint + dead-code scan.'),
      lint: z
        .boolean()
        .optional()
        .describe('Override lint execution for React Doctor.'),
      deadCode: z
        .boolean()
        .optional()
        .describe('Override dead-code execution for React Doctor.'),
    },
  }, async (args) => {
    const filePath = resolve(args.filePath);
    const projectRoot = args.projectRoot ? resolve(args.projectRoot) : dirname(filePath);
    const includeWarnings = args.includeWarnings ?? true;
    const analysisMode = args.analysisMode ?? 'smart';
    const lint = args.lint ?? true;
    const deadCode = args.deadCode ?? (analysisMode === 'full' ? true : false);
    const categoryFilter = buildCategoryFilter(args.categories);

    if (!existsSync(filePath)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: `Cannot read file: ${filePath}` }),
        }],
        isError: true,
      };
    }

    let doctorResult: ReactDoctorResult;
    try {
      doctorResult = await runReactDoctor(projectRoot, { lint, deadCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `React Doctor failed: ${message}`,
            source: 'react-doctor',
          }, null, 2),
        }],
        isError: true,
      };
    }

    const target = normalizePathForCompare(filePath);
    const diagnostics = doctorResult.diagnostics
      .map(entry => toDiagnostic(entry, projectRoot))
      .filter(diagnostic => {
        const absoluteDiagnosticPath = normalizePathForCompare(resolve(projectRoot, diagnostic.filePath));
        return absoluteDiagnosticPath === target;
      });

    const filteredDiagnostics = filterDiagnostics(diagnostics, categoryFilter, includeWarnings);
    sortDiagnostics(filteredDiagnostics);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          filePath: args.filePath,
          source: 'react-doctor',
          diagnosticCount: filteredDiagnostics.length,
          errorCount: filteredDiagnostics.filter(d => d.severity === 'error').length,
          warningCount: filteredDiagnostics.filter(d => d.severity === 'warning').length,
          diagnostics: filteredDiagnostics,
          lint,
          deadCode,
          analysisMode,
        }, null, 2),
      }],
    };
  });

  server.registerTool('nativereact_list_rules', {
    description:
      'List React Doctor rules available in the currently installed package version.',
    inputSchema: {},
  }, async () => {
    const catalog = getReactDoctorRuleCatalog();
    const categories = Array.from(new Set(catalog.map(rule => rule.category))).sort((a, b) => a.localeCompare(b));
    const meta = getReactDoctorPackageMeta();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          source: 'react-doctor',
          packageVersion: meta.version,
          totalRules: catalog.length,
          categories,
          rules: catalog,
        }, null, 2),
      }],
    };
  });
}
