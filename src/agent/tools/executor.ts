import { readFile, writeFile, readdir, appendFile, stat, mkdir } from 'fs/promises';
import { join, resolve, dirname, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

function validatePath(fullPath: string, workspace: string): boolean {
  return fullPath.startsWith(workspace);
}

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

function matchGlob(filename: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<!DOUBLESTAR!>')
    .replace(/\*/g, '[^/]*')
    .replace(/<!DOUBLESTAR!>/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

async function searchInFile(filePath: string, query: string, caseSensitive: boolean): Promise<Array<{ line: number; content: string }>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const matches: Array<{ line: number; content: string }> = [];

    const searchQuery = caseSensitive ? query : query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] ?? '';
      const lineContent = caseSensitive ? rawLine : rawLine.toLowerCase();
      if (lineContent.includes(searchQuery)) {
        matches.push({ line: i + 1, content: rawLine });
      }
    }

    return matches;
  } catch {
    return [];
  }
}

interface WalkResult {
  path: string;
  isDirectory: boolean;
  excluded?: boolean;
}

async function walkDirectory(dir: string, filePattern?: string, includeHidden = false): Promise<WalkResult[]> {
  const results: WalkResult[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          results.push({ path: fullPath, isDirectory: true, excluded: true });
        } else {
          const subFiles = await walkDirectory(fullPath, filePattern, includeHidden);
          results.push(...subFiles);
        }
      } else {
        if (!filePattern || matchGlob(entry.name, filePattern)) {
          results.push({ path: fullPath, isDirectory: false });
        }
      }
    }
  } catch {
    return results;
  }

  return results;
}

async function listFilesRecursive(dirPath: string, workspace: string, filterPattern?: string, includeHidden = false): Promise<WalkResult[]> {
  const fullPath = resolve(workspace, dirPath);
  const files = await walkDirectory(fullPath, filterPattern, includeHidden);
  const separator = workspace.endsWith('/') || workspace.endsWith('\\') ? '' : '/';

  return files.map(file => ({
    ...file,
    path: file.path.replace(workspace + separator, '')
  }));
}

async function findFilesByPattern(pattern: string, searchPath: string): Promise<string[]> {
  const results: string[] = [];

  const hasDoubleStar = pattern.includes('**');

  if (hasDoubleStar) {
    const parts = pattern.split('**');
    const filePattern = (parts[parts.length - 1] ?? '').replace(/^\//, '');
    const files = await walkDirectory(searchPath, undefined, false);
    const separator = searchPath.endsWith('/') || searchPath.endsWith('\\') ? '' : '/';

    for (const file of files) {
      if (file.excluded) continue;
      const relativePath = file.path.replace(searchPath + separator, '');
      if (matchGlob(relativePath, pattern)) {
        results.push(relativePath);
      }
    }
  } else {
    const entries = await readdir(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (matchGlob(entry.name, pattern) && entry.isFile()) {
        results.push(entry.name);
      }
    }
  }

  return results;
}

export async function executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = process.cwd();

  try {
    switch (toolName) {
      case 'read': {
        const path = args.path as string;
        const fullPath = resolve(workspace, path);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const content = await readFile(fullPath, 'utf-8');
        return {
          success: true,
          result: content
        };
      }

      case 'write': {
        const path = args.path as string;
        const content = typeof args.content === 'string' ? args.content : '';
        const append = args.append === true;
        const fullPath = resolve(workspace, path);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await mkdir(dirname(fullPath), { recursive: true });

        if (append) {
          await appendFile(fullPath, content, 'utf-8');
          return {
            success: true,
            result: `Content appended successfully to: ${path}`
          };
        } else {
          await writeFile(fullPath, content, 'utf-8');
          return {
            success: true,
            result: `File written successfully: ${path}`
          };
        }
      }

      case 'list': {
        const path = args.path as string;
        const recursive = args.recursive === null ? undefined : (args.recursive as boolean | undefined);
        const filter = args.filter === null ? undefined : (args.filter as string | undefined);
        const includeHidden = args.include_hidden === null ? undefined : (args.include_hidden as boolean | undefined);
        const fullPath = resolve(workspace, path);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        if (recursive) {
          const files = await listFilesRecursive(path, workspace, filter, includeHidden);
          const fileStats = await Promise.all(
            files.map(async (file) => {
              if (file.excluded) {
                return {
                  path: file.path,
                  type: 'directory',
                  excluded: true
                };
              }
              const filePath = resolve(workspace, file.path);
              const stats = await stat(filePath);
              return {
                path: file.path,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
              };
            })
          );
          return {
            success: true,
            result: JSON.stringify(fileStats, null, 2)
          };
        } else {
          const entries = await readdir(fullPath, { withFileTypes: true });
          let filteredEntries = entries;

          if (!includeHidden) {
            filteredEntries = filteredEntries.filter(entry => !entry.name.startsWith('.'));
          }

          if (filter) {
            const regex = new RegExp(filter.replace(/\*/g, '.*').replace(/\?/g, '.'));
            filteredEntries = filteredEntries.filter(entry => regex.test(entry.name));
          }

          const files = filteredEntries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            ...(entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name) ? { excluded: true } : {})
          }));

          return {
            success: true,
            result: JSON.stringify(files, null, 2)
          };
        }
      }

      case 'bash': {
        const command = args.command as string;
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspace,
          timeout: 30000
        });

        return {
          success: true,
          result: stdout || stderr || 'Command executed successfully'
        };
      }

      case 'grep': {
        const filePattern = args.file_pattern as string;
        const query = args.query === null ? undefined : (args.query as string | undefined);
        const searchPath = (args.path === null ? undefined : (args.path as string | undefined)) || '.';
        const caseSensitive = ((args.case_sensitive === null ? undefined : (args.case_sensitive as boolean | undefined)) ?? false);
        const maxResults = ((args.max_results === null ? undefined : (args.max_results as number | undefined)) ?? 100);
        const fullPath = resolve(workspace, searchPath);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const files = await findFilesByPattern(filePattern, fullPath);

        if (!query) {
          return {
            success: true,
            result: JSON.stringify(files, null, 2)
          };
        }

        const results: Array<{ file: string; matches: Array<{ line: number; content: string }> }> = [];
        let totalResults = 0;

        for (const file of files) {
          if (totalResults >= maxResults) break;

          const filePath = resolve(fullPath, file);
          const matches = await searchInFile(filePath, query, caseSensitive);
          if (matches.length > 0) {
            results.push({
              file: join(searchPath, file),
              matches: matches.slice(0, maxResults - totalResults)
            });
            totalResults += matches.length;
          }
        }

        return {
          success: true,
          result: JSON.stringify(results, null, 2)
        };
      }

      case 'edit': {
        const path = args.path as string;
        const oldContent = args.old_content as string;
        const newContent = args.new_content as string;
        const occurrence = ((args.occurrence === null ? undefined : (args.occurrence as number | undefined)) ?? 1);
        const fullPath = resolve(workspace, path);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const content = await readFile(fullPath, 'utf-8');
        const parts = content.split(oldContent);

        if (parts.length < occurrence + 1) {
          return {
            success: false,
            error: `Could not find occurrence ${occurrence} of the specified content`
          };
        }

        const before = parts.slice(0, occurrence).join(oldContent);
        const after = parts.slice(occurrence).join(oldContent);
        const updatedContent = before + newContent + after;

        await writeFile(fullPath, updatedContent, 'utf-8');

        return {
          success: true,
          result: `File edited successfully: ${path}`
        };
      }

      case 'create_directory': {
        const path = args.path as string;
        const extension = extname(path || '');
        const knownFileExtensions = new Set([
          '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
          '.py', '.go', '.java', '.kt', '.rb', '.php', '.rs',
          '.c', '.cc', '.cpp', '.h', '.hpp',
          '.json', '.yaml', '.yml', '.toml', '.ini',
          '.md', '.txt', '.env',
          '.sh', '.bat', '.ps1',
          '.html', '.css', '.scss', '.less',
        ]);
        if (extension && knownFileExtensions.has(extension.toLowerCase())) {
          return {
            success: false,
            error: `Refusing to create a directory at "${path}" because it looks like a file path. Use write with path "${path}" to create a file instead.`
          };
        }
        const fullPath = resolve(workspace, path);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await mkdir(fullPath, { recursive: true });

        return {
          success: true,
          result: `Directory created: ${path}`
        };
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}