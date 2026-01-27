export type NotificationType = 'info' | 'success' | 'error' | 'warning'

export interface NotificationPayload {
  message: string
  type?: NotificationType
  duration?: number
}

type NotificationListener = (payload: NotificationPayload) => void

const listeners = new Set<NotificationListener>()

export function subscribeNotifications(listener: NotificationListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyNotification(message: string, type: NotificationType = 'info', duration?: number): void {
  const payload: NotificationPayload = { message, type, duration }
  listeners.forEach((listener) => listener(payload))
}
