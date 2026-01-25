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

  const entryPoint = path.join(__dirname, '..', 'src', 'index.tsx');
  const args = process.argv.slice(2);

  const child = spawn('bun', ['run', entryPoint, ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
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
