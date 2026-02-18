export type ReactFramework =
  | 'nextjs'
  | 'remix'
  | 'expo'
  | 'react-native'
  | 'cra'
  | 'vite'
  | 'gatsby'
  | 'astro'
  | 'webpack'
  | 'rspack'
  | 'rsbuild'
  | 'parcel'
  | 'react-router'
  | 'tanstack-start'
  | 'custom'
  | 'unknown';

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'unknown';
export type RuntimeTarget = 'web' | 'native' | 'hybrid' | 'unknown';

export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  help: string;
  category: string;
}

export interface ProjectInfo {
  reactVersion: string | null;
  reactDomVersion: string | null;
  framework: ReactFramework;
  frameworks: ReactFramework[];
  language: 'typescript' | 'javascript' | 'mixed';
  packageManager: PackageManager;
  packageManagersDetected: PackageManager[];
  runtime: RuntimeTarget;
  isReactNative: boolean;
  hasReactCompiler: boolean;
  hasBuildScript: boolean;
  hasDevScript: boolean;
  hasTestScript: boolean;
  hasTestingLibrary: boolean;
  hasTypeScriptDependency: boolean;
  hasEslint: boolean;
  lockfiles: string[];
  packageCount: number;
  sourceFileCount: number;
  directory: string;
}

export interface DoctorResult {
  score: number;
  status: 'good' | 'ok' | 'poor';
  projectInfo: ProjectInfo;
  diagnostics: Diagnostic[];
  fileCount: number;
  scannedFileCount?: number;
  skippedFileCount?: number;
  analysisMode?: 'smart' | 'full';
  errorCount: number;
  warningCount: number;
  categoryBreakdown: Record<string, number>;
}

export interface SourceFile {
  path: string;
  content: string;
  lines: string[];
  ext: string;
  isClientComponent: boolean;
  isServerComponent: boolean;
  isTest: boolean;
  isJsx: boolean;
}

export interface RuleViolation {
  line: number;
  column: number;
  message: string;
  help: string;
}

export interface Rule {
  id: string;
  category: string;
  severity: 'error' | 'warning';
  jsxOnly?: boolean;
  skipTests?: boolean;
  frameworks?: Array<ProjectInfo['framework']>;
  check: (file: SourceFile, projectInfo: ProjectInfo) => RuleViolation[];
}
