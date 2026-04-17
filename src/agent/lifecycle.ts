import type { AgentRuntimeContext } from './types';

export type TaskLifecycleStage = 'pre_run' | 'post_edit' | 'post_verify' | 'end_task';

export interface TaskLifecycleContext {
  runtimeContext?: AgentRuntimeContext;
  changedPaths?: string[];
}

type TaskLifecycleHook = (context: TaskLifecycleContext) => void | Promise<void>;

const hooks: Record<TaskLifecycleStage, TaskLifecycleHook[]> = {
  pre_run: [],
  post_edit: [],
  post_verify: [],
  end_task: [],
};

export function registerTaskLifecycleHook(stage: TaskLifecycleStage, hook: TaskLifecycleHook): void {
  hooks[stage].push(hook);
}

export async function runTaskLifecycleStage(stage: TaskLifecycleStage, context: TaskLifecycleContext): Promise<void> {
  for (const hook of hooks[stage]) {
    await hook(context);
  }
}
