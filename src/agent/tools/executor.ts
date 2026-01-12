import { readFile, writeFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export async function executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = process.cwd();

  try {
    switch (toolName) {
      case 'read_file': {
        const path = args.path as string;
        const fullPath = resolve(workspace, path);

        if (!fullPath.startsWith(workspace)) {
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

      case 'write_file': {
        const path = args.path as string;
        const content = args.content as string;
        const fullPath = resolve(workspace, path);

        if (!fullPath.startsWith(workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await writeFile(fullPath, content, 'utf-8');
        return {
          success: true,
          result: `File written successfully: ${path}`
        };
      }

      case 'list_files': {
        const path = args.path as string;
        const fullPath = resolve(workspace, path);

        if (!fullPath.startsWith(workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const entries = await readdir(fullPath, { withFileTypes: true });
        const files = entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }));

        return {
          success: true,
          result: JSON.stringify(files, null, 2)
        };
      }

      case 'execute_command': {
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