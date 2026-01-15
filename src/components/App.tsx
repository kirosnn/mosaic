import { useState, useEffect } from 'react';
import type { KeyEvent } from '@opentui/core';
import { isFirstRun, markFirstRunComplete } from '../utils/config';
import { useRenderer } from '@opentui/react';
import { Welcome } from './Welcome';
import { Setup } from './Setup';
import { Main } from './Main';
import { ShortcutsModal } from './ShortcutsModal';
import { CommandModal } from './CommandsModal';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type AppScreen = 'welcome' | 'setup' | 'main';

export function App() {
  const [screen, setScreen] = useState<AppScreen>('main');
  const [isReady, setIsReady] = useState(false);
  const [pasteRequestId, setPasteRequestId] = useState(0);
  const [copyRequestId, setCopyRequestId] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutsTab, setShortcutsTab] = useState<0 | 1>(0);
  const [commandsOpen, setCommandsOpen] = useState(false);

  const renderer = useRenderer();

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
    const handleKeyPress = (key: KeyEvent) => {
      const k = key as any;
      const isCtrlV = (k.name === 'v' && k.ctrl) || k.sequence === '\x16';
      const isCmdV = process.platform === 'darwin' && k.name === 'v' && k.meta && !k.alt;
      const isAltV = process.platform !== 'darwin' && k.name === 'v' && (k.alt || k.meta) && !k.ctrl;

      const isCtrlP = (k.name === 'p' && k.ctrl) || k.sequence === '\x10';
      const isAltP = process.platform !== 'darwin' && k.name === 'p' && (k.alt || k.meta) && !k.ctrl;

      const isCtrlO = (k.name === 'o' && k.ctrl) || k.sequence === '\x0f';
      const isAltO = process.platform !== 'darwin' && k.name === 'o' && (k.alt || k.meta) && !k.ctrl;

      const isCtrlC = (k.name === 'c' && k.ctrl) || k.sequence === '\x03';
      const isCmdC = process.platform === 'darwin' && k.name === 'c' && k.meta && !k.alt;
      const isAltC = process.platform !== 'darwin' && k.name === 'c' && (k.alt || k.meta) && !k.ctrl;

      const isF1 = k.name === 'f1';
      const isF2 = k.name === 'f2';

      if (isCtrlV || isCmdV || isAltV) {
        setPasteRequestId(prev => prev + 1);
      }

      if (isCtrlP || isAltP) {
        setShortcutsOpen(prev => !prev);
      }

      if (isCtrlO || isAltO) {
        setCommandsOpen(prev => !prev);
      }

      if ((isCtrlC && !k.shift) || isCmdC || isAltC) {
        setCopyRequestId(prev => prev + 1);
      }

      if (shortcutsOpen && (isF1 || isF2)) {
        setShortcutsTab(isF2 ? 1 : 0);
      }

      if (k.name === 'escape') {
        setShortcutsOpen(false);
        setCommandsOpen(false);
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
      } else {
        setScreen('main');
      }
      setIsReady(true);
    };

    checkFirstRun();
  }, []);

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
      </box>
    );
  }

  if (screen === 'setup') {
    return (
      <box width="100%" height="100%">
        <Setup onComplete={handleSetupComplete} pasteRequestId={pasteRequestId} shortcutsOpen={shortcutsOpen} commandsOpen={commandsOpen} />
        {shortcutsOpen && <ShortcutsModal activeTab={shortcutsTab} />}
        {commandsOpen && <CommandModal />}
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
      />
      {shortcutsOpen && <ShortcutsModal activeTab={shortcutsTab} />}
      {commandsOpen && <CommandModal />}
    </box>
  );
}

export default App;