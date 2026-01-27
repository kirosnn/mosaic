import { shouldRequireApprovals } from './config'

type ApprovalModeListener = (requireApprovals: boolean) => void

const listeners = new Set<ApprovalModeListener>()

export function subscribeApprovalMode(listener: ApprovalModeListener): () => void {
  listeners.add(listener)
  listener(shouldRequireApprovals())
  return () => {
    listeners.delete(listener)
  }
}

export function emitApprovalMode(requireApprovals: boolean): void {
  listeners.forEach((listener) => listener(requireApprovals))
}
