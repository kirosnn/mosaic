import type { CoreTool } from 'ai';

import { execute_command } from './execute_command';
import { list_files } from './list_files';
import { read_file } from './read_file';
import { write_file } from './write_file';

export const tools: Record<string, CoreTool> = {
  read_file,
  write_file,
  list_files,
  execute_command,
};

export function getTools(): Record<string, CoreTool> {
  return tools;
}