import { useState, useEffect } from 'react';
import { isFirstRun, markFirstRunComplete } from '../utils/config';
import { Welcome } from './Welcome';
import { Setup } from './Setup';
import { Main } from './Main';

type AppScreen = 'welcome' | 'setup' | 'main';

export function App() {
  const [screen, setScreen] = useState<AppScreen>('main');
  const [isReady, setIsReady] = useState(false);

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
    return <Welcome onComplete={handleWelcomeComplete} isFirstRun={true} />;
  }

  if (screen === 'setup') {
    return <Setup onComplete={handleSetupComplete} />;
  }

  return <Main />;
}

export default App;