import { buildAssistantCapabilitySummary } from './assistantCapabilities';
import type { SmartContextMessage } from './context';
import { buildEnvironmentContextSummary } from './environmentContext';
import { collectGitWorkspaceState } from './gitWorkspaceState';
import type { AgentRuntimeContext } from './types';
import { scanRepository } from './repoScan';
import { detectTaskMode, isLightweightTaskMode, shouldBypassModelTaskRouter, shouldUseLightweightEnvironmentHandling, shouldUseRepositoryContext } from './taskMode';
import { detectTaskModeWithModel } from './taskModeModel';
import { buildSubsystemContextSummary } from '../utils/subsystemDiscovery';
import { getPreferredSubsystem } from '../utils/config';

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
  const deterministicTaskModeDecision = detectTaskMode(messages);
  const taskModeDecision = shouldBypassModelTaskRouter(deterministicTaskModeDecision)
    ? deterministicTaskModeDecision
    : await detectTaskModeWithModel(messages);

  const preferredSubsystem = getPreferredSubsystem();
  const subsystemContextSummary = await buildSubsystemContextSummary(preferredSubsystem);
  const environmentHandlingMode = taskModeDecision.mode === 'environment_config'
    ? (
      shouldUseLightweightEnvironmentHandling(messages, taskModeDecision)
        ? 'lightweight'
        : 'full'
    )
    : undefined;

  if (isLightweightTaskMode(taskModeDecision.mode)) {
    return {
      taskModeDecision,
      repoSummary: undefined,
      gitWorkspaceState: undefined,
      assistantCapabilitySummary: taskModeDecision.mode === 'assistant_capabilities'
        ? buildAssistantCapabilitySummary()
        : undefined,
      subsystemContextSummary,
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
      subsystemContextSummary,
      environmentHandlingMode,
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
    subsystemContextSummary,
    environmentHandlingMode,
  };
}
