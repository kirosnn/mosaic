import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Diagnostic, ProjectInfo, ReactFramework } from './types.js';

interface RootPackageInfo {
  scripts: Record<string, string>;
}

interface ProjectRuleDefinition {
  id: string;
  category: 'project';
  severity: 'error' | 'warning';
  frameworks?: ReactFramework[];
  run: (projectInfo: ProjectInfo, rootPackage: RootPackageInfo) => Diagnostic[];
}

function readRootPackageInfo(rootDir: string): RootPackageInfo {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { scripts: {} };
  }

  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    return {
      scripts: (raw.scripts as Record<string, string>) || {},
    };
  } catch {
    return { scripts: {} };
  }
}

function parseMajor(version: string | null): number | null {
  if (!version) return null;
  const match = version.match(/(\d{1,2})/);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function diagnostic(
  id: string,
  severity: 'error' | 'warning',
  message: string,
  help: string,
  filePath = 'package.json',
): Diagnostic {
  return {
    filePath,
    line: 1,
    column: 1,
    rule: id,
    severity,
    message,
    help,
    category: 'project',
  };
}

const PROJECT_RULES: ProjectRuleDefinition[] = [
  {
    id: 'projectMissingReactDependency',
    category: 'project',
    severity: 'error',
    run(projectInfo) {
      if (projectInfo.reactVersion || projectInfo.sourceFileCount === 0) return [];
      return [
        diagnostic(
          'projectMissingReactDependency',
          'error',
          'React source files detected but no React dependency was found in package.json files',
          'Install React in the app package: bun add react or npm install react.',
        ),
      ];
    },
  },
  {
    id: 'projectMissingReactDomDependency',
    category: 'project',
    severity: 'error',
    run(projectInfo) {
      if (!projectInfo.reactVersion) return [];
      if (projectInfo.runtime !== 'web' && projectInfo.runtime !== 'hybrid') return [];
      if (projectInfo.reactDomVersion) return [];
      return [
        diagnostic(
          'projectMissingReactDomDependency',
          'error',
          'Web React project missing react-dom dependency',
          'Install react-dom in the app package: bun add react-dom or npm install react-dom.',
        ),
      ];
    },
  },
  {
    id: 'projectReactDomMajorMismatch',
    category: 'project',
    severity: 'error',
    run(projectInfo) {
      if (!projectInfo.reactVersion || !projectInfo.reactDomVersion) return [];
      const reactMajor = parseMajor(projectInfo.reactVersion);
      const domMajor = parseMajor(projectInfo.reactDomVersion);
      if (reactMajor === null || domMajor === null || reactMajor === domMajor) return [];
      return [
        diagnostic(
          'projectReactDomMajorMismatch',
          'error',
          `react (${projectInfo.reactVersion}) and react-dom (${projectInfo.reactDomVersion}) major versions do not match`,
          'Use matching major versions for react and react-dom to avoid runtime and hydration errors.',
        ),
      ];
    },
  },
  {
    id: 'projectNextReactVersionTooOld',
    category: 'project',
    severity: 'error',
    frameworks: ['nextjs'],
    run(projectInfo) {
      if (!projectInfo.frameworks.includes('nextjs')) return [];
      const reactMajor = parseMajor(projectInfo.reactVersion);
      if (reactMajor === null || reactMajor >= 18) return [];
      return [
        diagnostic(
          'projectNextReactVersionTooOld',
          'error',
          `Next.js detected with React ${projectInfo.reactVersion}`,
          'Upgrade to React 18 or newer for supported Next.js app-router behavior.',
        ),
      ];
    },
  },
  {
    id: 'projectTypeScriptMissingDependency',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.language === 'javascript' || projectInfo.hasTypeScriptDependency) return [];
      return [
        diagnostic(
          'projectTypeScriptMissingDependency',
          'warning',
          'TypeScript files/config detected but TypeScript dependency is missing',
          'Install TypeScript in devDependencies to ensure consistent local and CI type-checking.',
        ),
      ];
    },
  },
  {
    id: 'projectMissingDevScript',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.hasDevScript) return [];
      return [
        diagnostic(
          'projectMissingDevScript',
          'warning',
          'No dev script found in package.json',
          'Add a dev script so contributors can run the app consistently, for example "dev": "vite" or "next dev".',
        ),
      ];
    },
  },
  {
    id: 'projectMissingBuildScript',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.runtime === 'native') return [];
      if (projectInfo.hasBuildScript) return [];
      return [
        diagnostic(
          'projectMissingBuildScript',
          'warning',
          'No build script found in package.json',
          'Add a build script to validate production output in CI, for example "build": "vite build" or "next build".',
        ),
      ];
    },
  },
  {
    id: 'projectMissingTestSetup',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.hasTestScript || projectInfo.hasTestingLibrary) return [];
      return [
        diagnostic(
          'projectMissingTestSetup',
          'warning',
          'No test runner detected for this React project',
          'Add a test setup such as Vitest, Jest, Playwright, or Cypress and expose it via a test script.',
        ),
      ];
    },
  },
  {
    id: 'projectMultiplePackageManagers',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.packageManagersDetected.length <= 1) return [];
      const managers = projectInfo.packageManagersDetected.join(', ');
      return [
        diagnostic(
          'projectMultiplePackageManagers',
          'warning',
          `Multiple package managers detected (${managers})`,
          'Use a single package manager and keep only one lockfile to avoid dependency drift.',
        ),
      ];
    },
  },
  {
    id: 'projectMissingLockfile',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.lockfiles.length > 0) return [];
      return [
        diagnostic(
          'projectMissingLockfile',
          'warning',
          'No lockfile detected at project root',
          'Commit a lockfile (bun.lock, pnpm-lock.yaml, yarn.lock, or package-lock.json) for reproducible installs.',
        ),
      ];
    },
  },
  {
    id: 'projectBunScriptsCallOtherManager',
    category: 'project',
    severity: 'warning',
    run(projectInfo, rootPackage) {
      if (projectInfo.packageManager !== 'bun') return [];
      const hasCrossPmScript = Object.values(rootPackage.scripts).some(script =>
        /\b(?:npm|pnpm|yarn)\s+(?:run|exec|dlx|install)\b/.test(script),
      );
      if (!hasCrossPmScript) return [];
      return [
        diagnostic(
          'projectBunScriptsCallOtherManager',
          'warning',
          'Bun project scripts invoke npm/pnpm/yarn commands',
          'Prefer bun run/bunx in scripts to keep installs and command execution consistent.',
        ),
      ];
    },
  },
  {
    id: 'projectMissingLintSetup',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.hasEslint) return [];
      return [
        diagnostic(
          'projectMissingLintSetup',
          'warning',
          'No ESLint dependency detected',
          'Add ESLint to catch React and hooks issues earlier in local development and CI.',
        ),
      ];
    },
  },
  {
    id: 'projectReactCompilerNotConfigured',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      const reactMajor = parseMajor(projectInfo.reactVersion);
      if (reactMajor === null || reactMajor < 19 || projectInfo.hasReactCompiler) return [];
      return [
        diagnostic(
          'projectReactCompilerNotConfigured',
          'warning',
          'React 19 detected without React Compiler tooling',
          'Evaluate React Compiler setup to unlock automatic memoization where it fits your app architecture.',
        ),
      ];
    },
  },
  {
    id: 'projectMixedFrameworkStack',
    category: 'project',
    severity: 'warning',
    run(projectInfo) {
      if (projectInfo.frameworks.length <= 1) return [];
      return [
        diagnostic(
          'projectMixedFrameworkStack',
          'warning',
          `Multiple React frameworks detected (${projectInfo.frameworks.join(', ')})`,
          'In monorepos, run diagnostics per package for framework-specific guidance and fewer false positives.',
        ),
      ];
    },
  },
];

export function runProjectDiagnostics(projectInfo: ProjectInfo, categories?: string[]): Diagnostic[] {
  if (categories && !categories.includes('project')) return [];
  const rootPackage = readRootPackageInfo(projectInfo.directory);
  const diagnostics: Diagnostic[] = [];
  for (const rule of PROJECT_RULES) {
    diagnostics.push(...rule.run(projectInfo, rootPackage));
  }
  return diagnostics;
}

export function listProjectRuleDefinitions(): Array<{
  id: string;
  category: string;
  severity: 'error' | 'warning';
  jsxOnly: boolean;
  skipTests: boolean;
  frameworks: ReactFramework[] | 'all';
}> {
  return PROJECT_RULES.map(rule => ({
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    jsxOnly: false,
    skipTests: false,
    frameworks: rule.frameworks ?? 'all',
  }));
}
