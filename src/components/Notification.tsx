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

  const Line = ({
    color,
    hasBackground,
    innerWidth,
    text,
  }: {
    color: string;
    hasBackground: boolean;
    innerWidth: number;
    text: string;
  }) => {
    const content = text.padEnd(innerWidth, ' ');
    const totalWidth = innerWidth + 2;

    return (
      <box flexDirection="row" backgroundColor={hasBackground ? "#111010ff" : "transparent"} width={totalWidth}>
        <text fg={color}>▎ </text>
        <text fg="white">{content}</text>
      </box>
    );
  };

  return (
    <box
      position="absolute"
      top={3}
      right={4}
      flexDirection="column"
      alignItems="flex-end"
      gap={1}
      minWidth={21}
    >
      {notifications.map((notification) => {
        const color = getTypeColor(notification.type);
        const hasBackground = notification.type !== 'error';

        const message = notification.message;
        const innerWidth = Math.max(1, message.length + 2);

        return (
          <box key={notification.id} flexDirection="column">
            <Line color={color} hasBackground={hasBackground} innerWidth={innerWidth} text="" />
            <Line color={color} hasBackground={hasBackground} innerWidth={innerWidth} text={`${message}  `} />
            <Line color={color} hasBackground={hasBackground} innerWidth={innerWidth} text="" />
          </box>
        );
      })}
    </box>
  );
}
