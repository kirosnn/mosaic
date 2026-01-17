import { readFile, writeFile, readdir, appendFile, stat, mkdir } from 'fs/promises';
import { join, resolve, dirname, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requestApproval } from '../../utils/approvalBridge';
import { shouldRequireApprovals } from '../../utils/config';
import { generateDiff, formatDiffForDisplay } from '../../utils/diff';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
  userMessage?: string;
  diff?: string[];
}

const pathValidationCache = new Map<string, boolean>();
const globPatternCache = new Map<string, RegExp>();

function validatePath(fullPath: string, workspace: string): boolean {
  const cacheKey = `${fullPath}|${workspace}`;
  const cached = pathValidationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = fullPath.startsWith(workspace);
  pathValidationCache.set(cacheKey, result);

  if (pathValidationCache.size > 1000) {
    const firstKey = pathValidationCache.keys().next().value;
    if (firstKey) pathValidationCache.delete(firstKey);
  }

  return result;
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
  let regex = globPatternCache.get(pattern);

  if (!regex) {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<!DOUBLESTAR!>')
      .replace(/\*/g, '[^/]*')
      .replace(/<!DOUBLESTAR!>/g, '.*')
      .replace(/\?/g, '.');

    regex = new RegExp(`^${regexPattern}$`);
    globPatternCache.set(pattern, regex);

    if (globPatternCache.size > 100) {
      const firstKey = globPatternCache.keys().next().value;
      if (firstKey) globPatternCache.delete(firstKey);
    }
  }

  return regex.test(filename);
}

async function searchInFile(filePath: string, query: string, caseSensitive: boolean): Promise<Array<{ line: number; content: string }>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    const matches: Array<{ line: number; content: string }> = [];

    let lineNumber = 1;
    let lineStart = 0;

    for (let i = 0; i <= content.length; i++) {
      if (i === content.length || content[i] === '\n') {
        const rawLine = content.slice(lineStart, i);
        const lineContent = caseSensitive ? rawLine : rawLine.toLowerCase();

        if (lineContent.includes(searchQuery)) {
          matches.push({ line: lineNumber, content: rawLine });
        }

        lineNumber++;
        lineStart = i + 1;
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
    const subDirPromises: Promise<WalkResult[]>[] = [];

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          results.push({ path: fullPath, isDirectory: true, excluded: true });
        } else {
          subDirPromises.push(walkDirectory(fullPath, filePattern, includeHidden));
        }
      } else {
        if (!filePattern || matchGlob(entry.name, filePattern)) {
          results.push({ path: fullPath, isDirectory: false });
        }
      }
    }

    if (subDirPromises.length > 0) {
      const subResults = await Promise.all(subDirPromises);
      for (const subResult of subResults) {
        results.push(...subResult);
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

async function generatePreview(toolName: string, args: Record<string, unknown>, workspace: string) {
  switch (toolName) {
    case 'write': {
      const path = args.path as string;
      const content = typeof args.content === 'string' ? args.content : '';
      const fullPath = resolve(workspace, path);

      if (!content || content.trim() === '') {
        return {
          title: `Write (${path})`,
          content: 'No new content in the file',
        };
      }

      let oldContent = '';
      try {
        oldContent = await readFile(fullPath, 'utf-8');
      } catch {
      }

      const diff = generateDiff(oldContent, content);
      const diffLines = formatDiffForDisplay(diff);

      return {
        title: `Write (${path})`,
        content: diffLines.join('\n'),
      };
    }

    case 'edit': {
      const path = args.path as string;
      const oldContent = args.old_content as string;
      const newContent = args.new_content as string;
      const occurrence = ((args.occurrence === null ? undefined : (args.occurrence as number | undefined)) ?? 1);

      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');

      const formattedLines: string[] = [];

      let startLineNumber = 1;
      try {
        const fullPath = resolve(workspace, path);
        const fileContent = await readFile(fullPath, 'utf-8');
        const fileLines = fileContent.split('\n');

        let occurrenceCount = 0;
        for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
          let match = true;
          for (let j = 0; j < oldLines.length; j++) {
            if (fileLines[i + j] !== oldLines[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            occurrenceCount++;
            if (occurrenceCount === occurrence) {
              startLineNumber = i + 1;
              break;
            }
          }
        }
      } catch {
      }

      for (let i = 0; i < oldLines.length; i++) {
        formattedLines.push(`-${String(startLineNumber + i).padStart(4)} | ${oldLines[i] ?? ''}`);
      }

      for (let i = 0; i < newLines.length; i++) {
        formattedLines.push(`+${String(startLineNumber + i).padStart(4)} | ${newLines[i] ?? ''}`);
      }

      return {
        title: `Edit (${path})`,
        content: formattedLines.join('\n'),
      };
    }

    case 'bash': {
      let command = args.command as string;

      const cleanCommand = command.replace(/\s+--timeout\s+\d+$/, '');

      return {
        title: `Command (${cleanCommand})`,
        content: cleanCommand,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = process.cwd();

  try {
    const needsApproval = (toolName === 'write' || toolName === 'edit' || toolName === 'bash') && shouldRequireApprovals();

    if (needsApproval) {
      const preview = await generatePreview(toolName, args, workspace);
      const approvalResult = await requestApproval(toolName as 'write' | 'edit' | 'bash', args, preview);

      if (!approvalResult.approved) {
        if (approvalResult.customResponse) {
          const userMessage = `Operation cancelled by user`;
          const agentError = `OPERATION REJECTED BY USER with custom instructions: "${approvalResult.customResponse}"

The user provided specific instructions for what to do instead. Follow their instructions carefully.

DO NOT use the question tool since the user already provided clear instructions in their custom response.`;

          return {
            success: false,
            error: agentError,
            userMessage: userMessage,
          };
        }

        let operationDescription = '';
        let suggestedOptions = '';
        switch (toolName) {
          case 'write':
            operationDescription = `writing to file "${args.path}"`;
            suggestedOptions = 'Options could be: "Modify the content", "Write to a different file", "Cancel operation"';
            break;
          case 'edit':
            operationDescription = `editing file "${args.path}"`;
            suggestedOptions = 'Options could be: "Modify the changes", "Edit a different part", "Cancel operation"';
            break;
          case 'bash':
            operationDescription = `executing command: ${args.command}`;
            suggestedOptions = 'Options could be: "Modify the command", "Use a different command", "Cancel operation"';
            break;
        }

        const agentError = `OPERATION REJECTED BY USER: ${operationDescription}

REQUIRED ACTION: You MUST use the question tool immediately to ask the user why they rejected this and what they want to do instead.

Example question tool usage:
question(
  prompt: "Why did you reject ${operationDescription}?",
  options: [
    { label: "${suggestedOptions.split(', ')[0]?.replace('Options could be: ', '').replace(/"/g, '')}", value: "modify" },
    { label: "${suggestedOptions.split(', ')[1]?.replace(/"/g, '')}", value: "alternative" },
    { label: "${suggestedOptions.split(', ')[2]?.replace(/"/g, '')}", value: "cancel" }
  ]
)

DO NOT continue without using the question tool. DO NOT ask in plain text.`;

        const userMessage = `Operation cancelled by user`;

        return {
          success: false,
          error: agentError,
          userMessage: userMessage,
        };
      }
    }

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

        let oldContent = '';
        try {
          oldContent = await readFile(fullPath, 'utf-8');
        } catch {
        }

        if (append) {
          await appendFile(fullPath, content, 'utf-8');
          return {
            success: true,
            result: `Content appended successfully to: ${path}`
          };
        } else {
          await writeFile(fullPath, content, 'utf-8');

          if (!content || content.trim() === '') {
            return {
              success: true,
              result: `No new content in the file`,
            };
          }

          const diff = generateDiff(oldContent, content);
          const diffLines = formatDiffForDisplay(diff);

          return {
            success: true,
            result: `File written successfully: ${path}`,
            diff: diffLines,
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
        let command = args.command as string;
        let timeout = 30000;

        const timeoutMatch = command.match(/\s+--timeout\s+(\d+)$/);
        if (timeoutMatch) {
          timeout = Math.min(parseInt(timeoutMatch[1] || '30000', 10), 90000);
          command = command.replace(/\s+--timeout\s+\d+$/, '');
        }

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workspace,
            timeout
          });

          const output = (stdout || '') + (stderr || '');
          return {
            success: true,
            result: output || 'Command executed with no output'
          };
        } catch (error: unknown) {
          const execError = error as { stdout?: string; stderr?: string; message?: string; code?: number };
          const errorMessage = execError.message || String(error);

          if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            const partialOutput = (execError.stdout || '') + (execError.stderr || '');
            const output = partialOutput
              ? `Command output (timed out after ${timeout}ms):\n${partialOutput}\n\n[Process continues running in background]`
              : `Command timed out after ${timeout}ms and produced no output.\n\n[Process may be running in background]`;

            return {
              success: true,
              result: output
            };
          }

          const output = (execError.stdout || '') + (execError.stderr || '');
          const exitCode = execError.code;
          const fullOutput = output
            ? `Command exited with code ${exitCode ?? 'unknown'}:\n${output}`
            : `Command failed: ${errorMessage}`;

          return {
            success: true,
            result: fullOutput
          };
        }
      }

      case 'glob': {
        const pattern = args.pattern as string;
        const searchPath = (args.path === null ? undefined : (args.path as string | undefined)) || '.';
        const fullPath = resolve(workspace, searchPath);

        if (!validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const files = await findFilesByPattern(pattern, fullPath);

        return {
          success: true,
          result: JSON.stringify(files, null, 2)
        };
      }

      case 'grep': {
        const pattern = args.pattern as string;
        const query = args.query as string;
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

        const files = await findFilesByPattern(pattern, fullPath);

        const results: Array<{ file: string; matches: Array<{ line: number; content: string }> }> = [];
        let totalResults = 0;

        const BATCH_SIZE = 10;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          if (totalResults >= maxResults) break;

          const batch = files.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (file) => {
              const filePath = resolve(fullPath, file);
              const matches = await searchInFile(filePath, query, caseSensitive);
              return { file: join(searchPath, file), matches };
            })
          );

          for (const { file, matches } of batchResults) {
            if (totalResults >= maxResults) break;
            if (matches.length > 0) {
              results.push({
                file,
                matches: matches.slice(0, maxResults - totalResults)
              });
              totalResults += matches.length;
            }
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

        await mkdir(dirname(fullPath), { recursive: true });

        let content = '';
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          content = '';
        }

        if (oldContent === '' && content === '') {
          await writeFile(fullPath, newContent, 'utf-8');

          const diff = generateDiff('', newContent);
          const diffLines = formatDiffForDisplay(diff);

          return {
            success: true,
            result: `File created and edited successfully: ${path}`,
            diff: diffLines,
          };
        }

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

        const diff = generateDiff(content, updatedContent);
        const diffLines = formatDiffForDisplay(diff);

        return {
          success: true,
          result: `File edited successfully: ${path}`,
          diff: diffLines,
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