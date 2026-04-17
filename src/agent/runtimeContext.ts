import type { SmartContextMessage } from './context';
import type { AgentRuntimeContext } from './types';
import { scanRepository } from './repoScan';
import { detectTaskMode } from './taskMode';

export function buildAgentRuntimeContext(messages: SmartContextMessage[]): AgentRuntimeContext {
  return {
    taskModeDecision: detectTaskMode(messages),
    repoSummary: scanRepository(),
  };
}
