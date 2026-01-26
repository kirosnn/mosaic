import type { CoreTool } from 'ai';

import { bash } from './bash.ts';
import { list } from './list.ts';
import { read } from './read.ts';
import { write } from './write.ts';
import { glob } from './glob.ts';
import { grep } from './grep.ts';
import { edit } from './edit.ts';
import { question } from './question.ts';
import { explore } from './explore.ts';
import { fetch } from './fetch.ts';
import { plan } from './plan.ts';

export const tools: Record<string, CoreTool> = {
  read,
  write,
  list,
  bash,
  glob,
  grep,
  edit,
  question,
  explore,
  fetch,
  plan,
};

export function getTools(): Record<string, CoreTool> {
  return tools;
}
