import { buildAssistantCapabilitySummary } from './assistantCapabilities';
import type { SmartContextMessage } from './context';
import { collectGitWorkspaceState } from './gitWorkspaceState';
import type { AgentRuntimeContext } from './types';
import { scanRepository } from './repoScan';
import { isLightweightTaskMode } from './taskMode';
import { detectTaskModeWithModel } from './taskModeModel';

export async function buildAgentRuntimeContext(messages: SmartContextMessage[]): Promise<AgentRuntimeContext> {
  const taskModeDecision = await detectTaskModeWithModel(messages);
  if (isLightweightTaskMode(taskModeDecision.mode)) {
    return {
      taskModeDecision,
      repoSummary: undefined,
      gitWorkspaceState: undefined,
      assistantCapabilitySummary: taskModeDecision.mode === 'assistant_capabilities'
        ? buildAssistantCapabilitySummary()
        : undefined,
    };
  }

  const [repoSummary, gitWorkspaceState] = await Promise.all([
    Promise.resolve(scanRepository()),
    collectGitWorkspaceState().catch(() => undefined),
  ]);

  return {
    taskModeDecision,
    repoSummary,
    gitWorkspaceState,
  };
}
