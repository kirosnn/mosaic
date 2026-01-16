import { useState, useEffect, useCallback } from 'react';
import type { KeyEvent } from '@opentui/core';
import { isFirstRun, markFirstRunComplete } from '../utils/config';
import { useRenderer } from '@opentui/react';
import { Welcome } from './Welcome';
import { Setup } from './Setup';
import { Main } from './Main';
import { ShortcutsModal } from './ShortcutsModal';
import { CommandModal } from './CommandsModal';
import { Notification, type NotificationData } from './Notification';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type AppScreen = 'welcome' | 'setup' | 'main';

interface AppProps {
  initialMessage?: string;
}

export function App({ initialMessage }: AppProps) {
  const [screen, setScreen] = useState<AppScreen>('main');
  const [isReady, setIsReady] = useState(false);
  const [pasteRequestId, setPasteRequestId] = useState(0);
  const [copyRequestId, setCopyRequestId] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutsTab, setShortcutsTab] = useState<0 | 1>(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(initialMessage);

  const renderer = useRenderer();

  const addNotification = useCallback((message: string, type: NotificationData['type'] = 'info', duration?: number) => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      if (process.platform === 'win32') {
        const escaped = text.replace(/'/g, "''");
        await execAsync(`powershell -command "Set-Clipboard -Value '${escaped}'"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`echo ${JSON.stringify(text)} | pbcopy`);
      } else {
        await execAsync(`echo ${JSON.stringify(text)} | xclip -selection clipboard`);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  useEffect(() => {
    const isDarwin = process.platform === 'darwin';

    const handleKeyPress = (key: KeyEvent) => {
      const k = key as any;

      if (k.name === 'escape') {
        setShortcutsOpen(false);
        setCommandsOpen(false);
        return;
      }

      if (shortcutsOpen && (k.name === 'f1' || k.name === 'f2')) {
        setShortcutsTab(k.name === 'f2' ? 1 : 0);
        return;
      }

      const seq = k.sequence;

      if (k.name === 'v' && (k.ctrl || (isDarwin && k.meta && !k.alt) || (!isDarwin && (k.alt || k.meta) && !k.ctrl)) || seq === '\x16') {
        setPasteRequestId(prev => prev + 1);
        return;
      }

      if (k.name === 'p' && (k.ctrl || (!isDarwin && (k.alt || k.meta) && !k.ctrl)) || seq === '\x10') {
        setShortcutsOpen(prev => !prev);
        return;
      }

      if (k.name === 'o' && (k.ctrl || (!isDarwin && (k.alt || k.meta) && !k.ctrl)) || seq === '\x0f') {
        setCommandsOpen(prev => !prev);
        return;
      }

      if (k.name === 'c' && !k.shift && (k.ctrl || (isDarwin && k.meta && !k.alt) || (!isDarwin && (k.alt || k.meta) && !k.ctrl)) || seq === '\x03') {
        setCopyRequestId(prev => prev + 1);
        return;
      }
    };

    renderer.keyInput.on('keypress', handleKeyPress);
    return () => {
      renderer.keyInput.off('keypress', handleKeyPress);
    };
  }, [renderer.keyInput, shortcutsOpen]);

  useEffect(() => {
    const checkFirstRun = async () => {
      const firstRun = isFirstRun();
      if (firstRun) {
        setScreen('welcome');
        if (pendingMessage) {
          addNotification('Please complete setup first', 'error', 5000);
        }
      } else {
        setScreen('main');
      }
      setIsReady(true);
    };

    checkFirstRun();
  }, [pendingMessage, addNotification]);

  const handleWelcomeComplete = () => {
    setScreen('setup');
  };

  const handleSetupComplete = (provider: string, model: string, apiKey?: string) => {
    markFirstRunComplete(provider, model, apiKey);
    setScreen('main');
  };

  if (!isReady) {
    return null;
  }

  if (screen === 'welcome') {
    return (
      <box width="100%" height="100%">
        <Welcome onComplete={handleWelcomeComplete} isFirstRun={true} shortcutsOpen={shortcutsOpen} commandsOpen={commandsOpen} />
        {shortcutsOpen && <ShortcutsModal activeTab={shortcutsTab} />}
        {commandsOpen && <CommandModal />}
        <Notification notifications={notifications} onRemove={removeNotification} />
      </box>
    );
  }

  if (screen === 'setup') {
    return (
      <box width="100%" height="100%">
        <Setup onComplete={handleSetupComplete} pasteRequestId={pasteRequestId} shortcutsOpen={shortcutsOpen} commandsOpen={commandsOpen} />
        {shortcutsOpen && <ShortcutsModal activeTab={shortcutsTab} />}
        {commandsOpen && <CommandModal />}
        <Notification notifications={notifications} onRemove={removeNotification} />
      </box>
    );
  }

  return (
    <box width="100%" height="100%">
      <Main
        pasteRequestId={pasteRequestId}
        copyRequestId={copyRequestId}
        onCopy={copyToClipboard}
        shortcutsOpen={shortcutsOpen}
        commandsOpen={commandsOpen}
        initialMessage={pendingMessage}
      />
      {shortcutsOpen && <ShortcutsModal activeTab={shortcutsTab} />}
      {commandsOpen && <CommandModal />}
      <Notification notifications={notifications} onRemove={removeNotification} />
    </box>
  );
}

export default App;