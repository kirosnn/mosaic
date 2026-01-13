import type { CoreTool } from 'ai';

import { execute_command } from './execute_command';
import { list_files } from './list_files';
import { read_file } from './read_file';
import { write_file } from './write_file';
import { grep } from './grep';
import { edit_file } from './edit_file';
import { create_directory } from './create_directory';

export const tools: Record<string, CoreTool> = {
  read_file,
  write_file,
  list_files,
  execute_command,
  grep,
  edit_file,
  create_directory,
};

export function getTools(): Record<string, CoreTool> {
  return tools;
}