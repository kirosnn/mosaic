import { useEffect } from 'react';

export type NotificationType = 'info' | 'success' | 'error' | 'warning';

export interface NotificationData {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
}

interface NotificationProps {
  notifications: NotificationData[];
  onRemove: (id: string) => void;
}

export function Notification({ notifications, onRemove }: NotificationProps) {
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    notifications.forEach((notification) => {
      const duration = notification.duration ?? 3000;
      const timer = setTimeout(() => {
        onRemove(notification.id);
      }, duration);
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [notifications, onRemove]);

  if (notifications.length === 0) {
    return null;
  }

  const getTypeColor = (type: NotificationType): string => {
    switch (type) {
      case 'success':
        return '#38ff65';
      case 'error':
        return '#ff3838';
      case 'warning':
        return '#ffca38';
      case 'info':
      default:
        return '#3899ff';
    }
  };

  return (
    <box
      position="absolute"
      top={1}
      right={2}
      flexDirection="column"
      alignItems="flex-end"
      gap={1}
    >
      {notifications.map((notification) => (
        <box
          key={notification.id}
          flexDirection="column"
        >
          <box
            flexDirection="row"
            backgroundColor="#1a1a1a"
          >
            <text fg={getTypeColor(notification.type)}>▎ </text>
            <text fg="white">  </text>
          </box>
          <box
            flexDirection="row"
            backgroundColor="#1a1a1a"
          >
            <text fg={getTypeColor(notification.type)}>▎ </text>
            <text fg="white">{notification.message}  </text>
          </box>
          <box
            flexDirection="row"
            backgroundColor="#1a1a1a"
          >
            <text fg={getTypeColor(notification.type)}>▎ </text>
            <text fg="white">  </text>
          </box>
        </box>
      ))}
    </box>
  );
}