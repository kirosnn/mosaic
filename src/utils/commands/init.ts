import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { Command } from './types';

const INIT_PROMPT = `Create a MOSAIC.md file in the root of the current workspace.

IMPORTANT: MOSAIC.md is NOT a README. It's a specialized context file that helps AI agents (like me) understand this project better when working in this workspace in the future.

The MOSAIC.md file should contain:

1. **Project Overview** - What this project does and its main purpose
2. **Architecture** - Key architectural patterns, design decisions, and how the codebase is organized
3. **Development Guidelines** - Important coding standards, naming conventions, and best practices specific to this project
4. **Key Files & Directories** - Critical files/folders and their purposes
5. **Common Tasks** - Frequent development tasks and how to accomplish them

First, analyze the existing codebase:
- Check package.json, README.md, and main source files
- Identify the technologies, frameworks, and tools used
- Understand the project structure and organization
- Look for existing documentation or comments

Then create a comprehensive MOSAIC.md file that will serve as a contextual guide for AI agents working in this workspace. Make it clear, concise, and practical. Focus on what an AI agent needs to know to be effective in this codebase.

DO NOT create a .mosaic directory - it has already been created automatically.`;

export const initCommand: Command = {
  name: 'init',
  description: 'Initialize the current workspace with Mosaic configuration (creates MOSAIC.md and .mosaic folder)',
  usage: '/init',
  aliases: ['i'],
  execute: async (): Promise<{ success: boolean; content: string; shouldAddToHistory?: boolean }> => {
    try {
      const mosaicDir = join(process.cwd(), '.mosaic');
      await mkdir(mosaicDir, { recursive: true });
    } catch (error) {
      return {
        success: false,
        content: `Failed to create .mosaic directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToHistory: false
      };
    }

    return {
      success: true,
      content: INIT_PROMPT,
      shouldAddToHistory: true
    };
  }
};
