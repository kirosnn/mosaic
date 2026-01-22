import type { Command } from './index';

export const webCommand: Command = {
  name: 'web',
  description: 'Launch the web interface on http://127.0.0.1:8192',
  usage: '/web',
  aliases: ['w'],
  execute: async (): Promise<{ success: boolean; content: string; shouldAddToHistory?: boolean }> => {
    try {
      const { spawn } = await import('child_process');
      const path = await import('path');
      const fs = await import('fs');

      const serverPath = path.join(__dirname, '..', '..', 'web', 'server.ts');

      if (!fs.existsSync(serverPath)) {
        return {
          success: false,
          content: `Web server file not found at: ${serverPath}`,
          shouldAddToHistory: false
        };
      }

      const serverProcess = spawn('bun', ['run', serverPath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MOSAIC_PROJECT_PATH: process.cwd()
        }
      });

      let startupError = '';

      serverProcess.stderr?.on('data', (data) => {
        startupError += data.toString();
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (startupError) {
            reject(new Error(startupError));
          } else {
            resolve();
          }
        }, 2000);

        serverProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        serverProcess.stdout?.on('data', (data) => {
          const output = data.toString();
          if (output.includes('running on')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      serverProcess.unref();

      return {
        success: true,
        content: 'Web interface started successfully!\n\nOpen your browser at: http://127.0.0.1:8192',
        shouldAddToHistory: false
      };
    } catch (error) {
      return {
        success: false,
        content: `Failed to start web interface: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToHistory: false
      };
    }
  }
};
