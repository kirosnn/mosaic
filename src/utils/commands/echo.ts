import type { Command } from './types';
import { notifyNotification } from '../notificationBridge';

export const echoCommand: Command = {
  name: 'echo',
  description: 'Echo the provided text back to the user',
  usage: '/echo <text>',
  aliases: ['e'],
  execute: (args: string[], _fullCommand: string) => {
    if (args.length === 0) {
      return {
        success: false,
        content: 'Error: /echo requires text to echo. Usage: /echo <text>'
      };
    }

    const mode = args[0]!.toLowerCase();
    const text = args.slice(1).join(' ').trim();

    if (mode === 'error') {
      if (!text) {
        return {
          success: false,
          content: 'Error: /echo error requires a message. Usage: /echo error <message>'
        };
      }
      const banner = `echo error ${text}`;
      return {
        success: false,
        content: '',
        errorBanner: banner,
        shouldAddToHistory: false
      };
    }

    if (mode === 'notif' || mode === 'notification') {
      const message = text || 'Test notification';
      notifyNotification(message, 'info');
      return {
        success: true,
        content: `Notification: ${message}`
      };
    }

    return {
      success: true,
      content: args.join(' ')
    };
  }
};
