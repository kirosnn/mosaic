import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { Command } from './types';

const INIT_PROMPT = `Analyze the codebase and create or update the MOSAIC.md file in the root of the current workspace.

IMPORTANT: MOSAIC.md is NOT a README. It's a specialized context file that helps AI agents (like me) understand this project better when working in this workspace in the future. 
MANDATORY: You have to create or modify MOSAIC.md file before finishing the task, that's the most important user's request.

The MOSAIC.md file should contain:

1. **Project Overview** - What this project does and its main purpose
2. **Architecture** - Key architectural patterns, design decisions, and how the codebase is organized
3. **Development Guidelines** - Important coding standards, naming conventions, and best practices specific to this project
4. **Key Files & Directories** - Critical files/folders and their purposes
5. **Common Tasks** - Frequent development tasks and how to accomplish them

WORKFLOW - Use glob, read, and grep DIRECTLY. Do NOT use the explore tool for this task.

Step 1 - Gather context using parallel tool calls:
- glob(pattern="*") to list root files
- glob(pattern="src/**/*", maxDepth=2) to understand source structure
- read package.json, README.md, tsconfig.json (or equivalent config files), if they don't exist, just continue to gather context across the codebase

Step 2 - Dive deeper based on what you found:
- Read main entry points and key source files
- grep for patterns, frameworks, conventions

Step 3 - Create or update MOSAIC.md:

**If MOSAIC.md already exists:**
- Read the existing MOSAIC.md file first
- Analyze if any sections need updates based on current codebase state
- Add any missing architectural patterns, new tools, or important workflows discovered
- Update outdated information (dependencies versions, file paths, deprecated patterns)
- Improve clarity and add details where needed
- Keep the existing structure and relevant information
- DO NOT recreate the file from scratch - use the edit tool to make targeted improvements

**If MOSAIC.md does not exist:**
- Create a comprehensive MOSAIC.md file that will serve as a contextual guide for AI agents working in this workspace

Even if the file seems complete, always look for potential improvements:
- Are there new features or patterns in the code not documented?
- Are all critical workflows explained?
- Could any section be clearer or more detailed?
- Are there undocumented conventions or best practices?

Make it clear, concise, and practical. Focus on what an AI agent needs to know to be effective in this codebase.

DO NOT create a .mosaic directory - it has already been created automatically.`;

export const initCommand: Command = {
  name: 'init',
  description: 'Initialize the current workspace with Mosaic configuration (creates or updates MOSAIC.md and .mosaic folder)',
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