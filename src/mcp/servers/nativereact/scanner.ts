import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { SourceFile } from './types.js';

const REACT_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs', '.cts', '.cjs', '.mdx']);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo',
  '.cache', 'coverage', '__snapshots__', '.expo', '.vercel', '.svelte-kit',
  'storybook-static', '.storybook',
]);
const TEST_PATTERNS = ['.test.', '.spec.', '__tests__', '.stories.'];

export function discoverFiles(dir: string, maxFiles = 1000): string[] {
  const files: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > 12 || files.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && REACT_EXTENSIONS.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir, 0);
  return files;
}

export function readSourceFile(filePath: string): SourceFile | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (content.length > 500_000) return null;
    const lines = content.split('\n');
    const ext = extname(filePath);
    const isTest = TEST_PATTERNS.some(p => filePath.includes(p));
    const isJsx = ext === '.tsx' || ext === '.jsx';
    const isClientComponent = content.includes("'use client'") || content.includes('"use client"');
    const isServerComponent =
      !isClientComponent &&
      (content.includes("'use server'") || content.includes('"use server"'));

    return { path: filePath, content, lines, ext, isClientComponent, isServerComponent, isTest, isJsx };
  } catch {
    return null;
  }
}
