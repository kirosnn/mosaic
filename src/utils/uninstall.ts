import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function uninstallMosaic(force: boolean = false): Promise<void> {
  console.log('\nMosaic Uninstall\n');

  const configDir = join(homedir(), '.mosaic');
  const hasConfig = existsSync(configDir);

  if (!force) {
    console.log('This will unlink the Mosaic CLI from your system.');
    if (hasConfig) {
      console.log('Your configuration and history will be preserved in ~/.mosaic');
      console.log('\nTo also remove all data, use: mosaic uninstall --force');
    }

    console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    const { execSync } = await import('child_process');

    console.log('\nUnlinking Mosaic...');
    try {
      execSync('bun unlink mosaic-cli', { stdio: 'inherit' });
      console.log('✓ Mosaic unlinked successfully');
    } catch (error) {
      console.log('Note: Could not unlink (may not be linked)');
    }

    if (force && hasConfig) {
      console.log('\nRemoving configuration and history...');
      rmSync(configDir, { recursive: true, force: true });
      console.log('✓ All data removed from ~/.mosaic');
    }

    console.log('\n✓ Uninstall complete');
    console.log('\nTo reinstall, run: bun link');
  } catch (error) {
    console.error(`\nError during uninstall: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}