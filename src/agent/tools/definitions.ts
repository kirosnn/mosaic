import type { CoreTool } from 'ai';

import { bash } from './bash.ts';
import { list } from './list.ts';
import { read } from './read.ts';
import { write } from './write.ts';
import { grep } from './grep.ts';
import { edit } from './edit.ts';
import { question } from './question.ts';

export const tools: Record<string, CoreTool> = {
  read,
  write,
  list,
  bash,
  grep,
  edit,
  question,
};

export function getTools(): Record<string, CoreTool> {
  return tools;
}