#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const path = require('path');

function isBunInstalled() {
  try {
    const result = spawnSync('bun', ['--version'], {
      stdio: 'pipe',
      shell: process.platform === 'win32'
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function main() {
  if (!isBunInstalled()) {
    console.error('\x1b[31mError: Bun runtime is required to run Mosaic.\x1b[0m');
    console.error('');
    console.error('Please install Bun first:');
    console.error('');
    if (process.platform === 'win32') {
      console.error('  \x1b[36mpowershell -c "irm bun.sh/install.ps1 | iex"\x1b[0m');
    } else {
      console.error('  \x1b[36mcurl -fsSL https://bun.sh/install | bash\x1b[0m');
    }
    console.error('');
    console.error('For more information, visit: https://bun.sh');
    process.exit(1);
  }

  const packageRoot = path.resolve(__dirname, '..');
  const entryPoint = path.join(packageRoot, 'src', 'app', 'cli', 'main.tsx');
  const args = process.argv.slice(2);

  // Spawn with the mosaic package root as cwd so bun resolves node_modules correctly
  // (bun link on Windows doesn't chain resolution back to the linked package's node_modules).
  // The user's original working directory is passed via env so the app can restore it.
  const child = spawn('bun', ['run', entryPoint, ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: packageRoot,
    env: {
      ...process.env,
      MOSAIC_WORKSPACE: process.env.MOSAIC_WORKSPACE || process.cwd(),
    },
  });

  child.on('error', (error) => {
    console.error(`Failed to start Mosaic: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
