import { buildAssistantCapabilitySummary } from './assistantCapabilities';
import type { SmartContextMessage } from './context';
import { buildEnvironmentContextSummary } from './environmentContext';
import { collectGitWorkspaceState } from './gitWorkspaceState';
import type { AgentRuntimeContext } from './types';
import { scanRepository } from './repoScan';
import { detectTaskMode, isLightweightChatIntent, isLightweightTaskMode, shouldUseRepositoryContext } from './taskMode';
import { detectTaskModeWithModel } from './taskModeModel';

function getLatestUserRequest(messages: SmartContextMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

export async function buildAgentRuntimeContext(messages: SmartContextMessage[]): Promise<AgentRuntimeContext> {
  const latestRequest = getLatestUserRequest(messages);
  const taskModeDecision = isLightweightChatIntent(latestRequest)
    ? detectTaskMode(messages)
    : await detectTaskModeWithModel(messages);

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

  if (!shouldUseRepositoryContext(taskModeDecision.mode)) {
    return {
      taskModeDecision,
      repoSummary: undefined,
      gitWorkspaceState: undefined,
      environmentContextSummary: taskModeDecision.mode === 'environment_config'
        ? buildEnvironmentContextSummary(taskModeDecision.latestUserRequest)
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
