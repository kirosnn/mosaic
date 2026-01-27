import type { Command } from './types'
import { getCurrentApproval, respondApproval } from '../approvalBridge'
import { shouldRequireApprovals, setRequireApprovals } from '../config'
import { notifyNotification } from '../notificationBridge'
import { emitApprovalMode } from '../approvalModeBridge'

export const approvalsCommand: Command = {
  name: 'approvals',
  description: 'Toggle approval prompts for agent changes',
  usage: '/approvals on|off|toggle|status',
  aliases: ['approval', 'autoapprove', 'auto-approve'],
  execute: (args: string[]) => {
    const raw = args[0]?.toLowerCase()
    const current = shouldRequireApprovals()
    let next = current

    if (!raw || raw === 'toggle') {
      next = !current
    } else if (raw === 'on' || raw === 'true' || raw === 'yes') {
      next = true
    } else if (raw === 'off' || raw === 'false' || raw === 'no') {
      next = false
    } else if (raw === 'status') {
      return {
        success: true,
        content: current ? 'Approvals are enabled.' : 'Auto-approve is enabled.'
      }
    } else {
      return {
        success: false,
        content: 'Usage: /approvals on|off|toggle|status'
      }
    }

    setRequireApprovals(next)
    if (!next && getCurrentApproval()) {
      respondApproval(true)
    }
    emitApprovalMode(next)

    notifyNotification(next ? 'Approvals enabled.' : 'Auto-approve enabled.', 'info', 2500)

    return {
      success: true,
      content: next ? 'Approvals enabled.' : 'Auto-approve enabled.'
    }
  }
}
