import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import type { PackageManager, ProjectInfo, ReactFramework } from './types.js';

interface PackageSnapshot {
  path: string;
  packageManager: PackageManager;
  scripts: Record<string, string>;
  deps: Record<string, string>;
}

const LOCKFILE_NAMES: Array<{ file: string; manager: PackageManager }> = [
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

const FRAMEWORK_PRIORITY: ReactFramework[] = [
  'nextjs',
  'remix',
  'tanstack-start',
  'react-router',
  'expo',
  'react-native',
  'vite',
  'gatsby',
  'astro',
  'cra',
  'rsbuild',
  'rspack',
  'webpack',
  'parcel',
];

const WEB_FRAMEWORKS = new Set<ReactFramework>([
  'nextjs',
  'remix',
  'tanstack-start',
  'react-router',
  'vite',
  'gatsby',
  'astro',
  'cra',
  'rsbuild',
  'rspack',
  'webpack',
  'parcel',
]);

const ROOT_CONFIG_MATCHERS: Array<{ framework: ReactFramework; files: string[] }> = [
  { framework: 'nextjs', files: ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'] },
  { framework: 'remix', files: ['remix.config.js', 'remix.config.mjs', 'remix.config.cjs', 'remix.config.ts'] },
  { framework: 'expo', files: ['app.json', 'app.config.js', 'app.config.ts'] },
  { framework: 'vite', files: ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'] },
  { framework: 'gatsby', files: ['gatsby-config.js', 'gatsby-config.ts'] },
  { framework: 'astro', files: ['astro.config.ts', 'astro.config.mjs', 'astro.config.js'] },
  { framework: 'webpack', files: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs', 'webpack.config.cjs'] },
  { framework: 'rspack', files: ['rspack.config.js', 'rspack.config.ts', 'rspack.config.mjs', 'rspack.config.cjs'] },
  { framework: 'rsbuild', files: ['rsbuild.config.ts', 'rsbuild.config.js', 'rsbuild.config.mjs'] },
  { framework: 'parcel', files: ['.parcelrc'] },
  { framework: 'react-router', files: ['react-router.config.ts', 'react-router.config.js'] },
];

function normalizePackageManager(value: unknown): PackageManager {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const raw = value.split('@')[0]?.trim().toLowerCase() ?? '';
  if (raw === 'bun') return 'bun';
  if (raw === 'pnpm') return 'pnpm';
  if (raw === 'yarn') return 'yarn';
  if (raw === 'npm') return 'npm';
  return 'unknown';
}

function readPackageJson(pkgPath: string): PackageSnapshot | null {
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const scripts = (raw.scripts as Record<string, string>) || {};
    const deps: Record<string, string> = {
      ...((raw.dependencies as Record<string, string>) || {}),
      ...((raw.devDependencies as Record<string, string>) || {}),
      ...((raw.peerDependencies as Record<string, string>) || {}),
      ...((raw.optionalDependencies as Record<string, string>) || {}),
    };
    return {
      path: pkgPath,
      packageManager: normalizePackageManager(raw.packageManager),
      scripts,
      deps,
    };
  } catch {
    return null;
  }
}

function isInsideRoot(candidate: string, root: string): boolean {
  const normalized = resolve(candidate).toLowerCase();
  const normalizedRoot = resolve(root).toLowerCase();
  if (normalized === normalizedRoot) return true;
  return normalized.startsWith(`${normalizedRoot}\\`) || normalized.startsWith(`${normalizedRoot}/`);
}

function collectPackageJsonPaths(rootDir: string, sourceFiles: string[]): string[] {
  const paths = new Set<string>();
  const rootPkg = join(rootDir, 'package.json');
  if (existsSync(rootPkg)) paths.add(rootPkg);

  for (const filePath of sourceFiles) {
    let current = dirname(filePath);
    for (let depth = 0; depth < 20; depth++) {
      if (!isInsideRoot(current, rootDir)) break;
      const pkgPath = join(current, 'package.json');
      if (existsSync(pkgPath)) {
        paths.add(pkgPath);
      }
      if (resolve(current) === resolve(rootDir)) break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  if (paths.size === 0) {
    const entries = safeReadDir(rootDir);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(rootDir, entry.name, 'package.json');
      if (existsSync(pkgPath)) {
        paths.add(pkgPath);
      }
    }
  }

  return Array.from(paths);
}

function safeReadDir(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectVersionSet(snapshots: PackageSnapshot[], depName: string): Set<string> {
  const versions = new Set<string>();
  for (const pkg of snapshots) {
    const version = pkg.deps[depName];
    if (version) versions.add(version);
  }
  return versions;
}

function pickPreferredVersion(
  snapshots: PackageSnapshot[],
  depName: string,
  rootDir: string,
): string | null {
  const rootPkg = snapshots.find(s => resolve(dirname(s.path)) === resolve(rootDir));
  if (rootPkg?.deps[depName]) return rootPkg.deps[depName] ?? null;
  for (const pkg of snapshots) {
    const version = pkg.deps[depName];
    if (version) return version;
  }
  return null;
}

function detectFrameworks(snapshots: PackageSnapshot[], rootDir: string): Set<ReactFramework> {
  const frameworks = new Set<ReactFramework>();

  for (const pkg of snapshots) {
    const deps = pkg.deps;
    const scriptsText = Object.values(pkg.scripts).join(' \n ').toLowerCase();

    if (deps['next']) frameworks.add('nextjs');
    if (deps['@remix-run/react'] || deps['@remix-run/node']) frameworks.add('remix');
    if (deps['@tanstack/react-start']) frameworks.add('tanstack-start');
    if (deps['@react-router/dev'] || deps['@react-router/node'] || deps['@react-router/serve']) frameworks.add('react-router');
    if (deps['expo']) frameworks.add('expo');
    if (deps['react-native']) frameworks.add('react-native');
    if (deps['react-scripts']) frameworks.add('cra');
    if (deps['vite'] || deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-react-swc']) frameworks.add('vite');
    if (deps['gatsby']) frameworks.add('gatsby');
    if (deps['astro'] || deps['@astrojs/react']) frameworks.add('astro');
    if (deps['@rsbuild/core']) frameworks.add('rsbuild');
    if (deps['@rspack/core'] || deps['rspack']) frameworks.add('rspack');
    if (deps['webpack'] || deps['webpack-cli']) frameworks.add('webpack');
    if (deps['parcel']) frameworks.add('parcel');

    if (/\bnext\s+(?:dev|build|start)\b/.test(scriptsText)) frameworks.add('nextjs');
    if (/\bremix\s+(?:dev|build)\b/.test(scriptsText)) frameworks.add('remix');
    if (/\bexpo\s+(?:start|run|build)\b/.test(scriptsText)) frameworks.add('expo');
    if (/\breact-router\b/.test(scriptsText)) frameworks.add('react-router');
    if (/\btanstack\b/.test(scriptsText) && /\bstart\b/.test(scriptsText)) frameworks.add('tanstack-start');
    if (/\bvite\b/.test(scriptsText)) frameworks.add('vite');
    if (/\bgatsby\b/.test(scriptsText)) frameworks.add('gatsby');
    if (/\bastro\b/.test(scriptsText)) frameworks.add('astro');
    if (/\brsbuild\b/.test(scriptsText)) frameworks.add('rsbuild');
    if (/\brspack\b/.test(scriptsText)) frameworks.add('rspack');
    if (/\bwebpack\b/.test(scriptsText)) frameworks.add('webpack');
    if (/\bparcel\b/.test(scriptsText)) frameworks.add('parcel');
  }

  const roots = new Set<string>([rootDir, ...snapshots.map(s => dirname(s.path))]);
  for (const candidateRoot of roots) {
    for (const matcher of ROOT_CONFIG_MATCHERS) {
      for (const fileName of matcher.files) {
        if (existsSync(join(candidateRoot, fileName))) {
          frameworks.add(matcher.framework);
          break;
        }
      }
    }
  }

  return frameworks;
}

function inferPrimaryFramework(frameworks: Set<ReactFramework>, hasReact: boolean): ReactFramework {
  for (const candidate of FRAMEWORK_PRIORITY) {
    if (frameworks.has(candidate)) return candidate;
  }
  if (hasReact) return 'custom';
  return 'unknown';
}

function extractPackageManagers(rootDir: string, snapshots: PackageSnapshot[]): {
  packageManagersDetected: PackageManager[];
  packageManager: PackageManager;
  lockfiles: string[];
} {
  const detected = new Set<PackageManager>();
  const lockfiles: string[] = [];

  for (const lockfile of LOCKFILE_NAMES) {
    if (existsSync(join(rootDir, lockfile.file))) {
      detected.add(lockfile.manager);
      lockfiles.push(lockfile.file);
    }
  }

  const rootPackageManager = snapshots.find(s => resolve(dirname(s.path)) === resolve(rootDir))?.packageManager;
  for (const snapshot of snapshots) {
    if (snapshot.packageManager !== 'unknown') detected.add(snapshot.packageManager);
  }

  const packageManagersDetected = Array.from(detected);
  let packageManager: PackageManager = 'unknown';
  if (rootPackageManager && rootPackageManager !== 'unknown') {
    packageManager = rootPackageManager;
  } else if (packageManagersDetected.length === 1) {
    packageManager = packageManagersDetected[0] ?? 'unknown';
  }

  return { packageManagersDetected, packageManager, lockfiles };
}

export function detectProject(
  dir: string,
  fileCount: number,
  sourceFiles: string[] = [],
): ProjectInfo {
  const rootDir = resolve(dir);
  const packageJsonPaths = collectPackageJsonPaths(rootDir, sourceFiles);
  const snapshots = packageJsonPaths
    .map(path => readPackageJson(path))
    .filter((pkg): pkg is PackageSnapshot => pkg !== null);

  const reactVersion = pickPreferredVersion(snapshots, 'react', rootDir);
  const reactDomVersion = pickPreferredVersion(snapshots, 'react-dom', rootDir);
  const frameworksSet = detectFrameworks(snapshots, rootDir);
  const frameworks = FRAMEWORK_PRIORITY.filter(f => frameworksSet.has(f));
  const hasReact = !!reactVersion || collectVersionSet(snapshots, 'react').size > 0;
  const framework = inferPrimaryFramework(frameworksSet, hasReact);
  const hasNativeStack = frameworksSet.has('expo') || frameworksSet.has('react-native') || collectVersionSet(snapshots, 'react-native').size > 0;
  const hasExplicitWebStack = !!reactDomVersion || frameworks.some(f => WEB_FRAMEWORKS.has(f));
  const hasWebStack = hasExplicitWebStack || (!hasNativeStack && hasReact);

  let runtime: ProjectInfo['runtime'] = 'unknown';
  if (hasNativeStack && hasWebStack) runtime = 'hybrid';
  else if (hasNativeStack) runtime = 'native';
  else if (hasWebStack) runtime = 'web';

  const hasReactCompiler = snapshots.some(pkg =>
    !!(pkg.deps['babel-plugin-react-compiler'] || pkg.deps['react-compiler-runtime'] || pkg.deps['eslint-plugin-react-compiler']),
  );

  const hasTsConfig = existsSync(join(rootDir, 'tsconfig.json')) || snapshots.some(pkg => existsSync(join(dirname(pkg.path), 'tsconfig.json')));
  const hasTsSources = sourceFiles.some(file => {
    const ext = extname(file).toLowerCase();
    return ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts';
  });
  const hasJsSources = sourceFiles.some(file => {
    const ext = extname(file).toLowerCase();
    return ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs';
  });

  let language: ProjectInfo['language'] = 'javascript';
  if ((hasTsSources || hasTsConfig) && hasJsSources) language = 'mixed';
  else if (hasTsSources || hasTsConfig) language = 'typescript';

  const scripts = snapshots.map(s => s.scripts);
  const hasScript = (name: 'dev' | 'build' | 'test'): boolean =>
    scripts.some(s => typeof s[name] === 'string' && s[name].trim().length > 0);

  const depsLookup = (name: string): boolean => snapshots.some(pkg => !!pkg.deps[name]);
  const hasTestingLibrary =
    depsLookup('@testing-library/react') ||
    depsLookup('@testing-library/react-native') ||
    depsLookup('vitest') ||
    depsLookup('jest') ||
    depsLookup('@playwright/test') ||
    depsLookup('playwright') ||
    depsLookup('cypress');
  const hasTypeScriptDependency = depsLookup('typescript');
  const hasEslint = depsLookup('eslint') || depsLookup('@eslint/js') || depsLookup('typescript-eslint');

  const { packageManager, packageManagersDetected, lockfiles } = extractPackageManagers(rootDir, snapshots);

  return {
    reactVersion,
    reactDomVersion,
    framework,
    frameworks: frameworks.length > 0 ? frameworks : framework === 'unknown' ? [] : [framework],
    language,
    packageManager,
    packageManagersDetected,
    runtime,
    isReactNative: hasNativeStack,
    hasReactCompiler,
    hasBuildScript: hasScript('build'),
    hasDevScript: hasScript('dev'),
    hasTestScript: hasScript('test'),
    hasTestingLibrary,
    hasTypeScriptDependency,
    hasEslint,
    lockfiles,
    packageCount: snapshots.length,
    sourceFileCount: fileCount,
    directory: rootDir,
  };
}
