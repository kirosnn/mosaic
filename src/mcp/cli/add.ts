import { createInterface } from 'readline';
import { saveServerConfig, loadMcpConfig } from '../config';
import { MCP_REGISTRY, findRegistryEntry, type McpRegistryEntry } from '../registry';
import type { McpServerConfig } from '../types';

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, (answer: string) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export async function mcpAdd(nameArg?: string): Promise<void> {
  const existing = loadMcpConfig();
  const existingIds = new Set(existing.map(c => c.id));

  if (nameArg) {
    const entry = findRegistryEntry(nameArg);
    if (entry) {
      if (existingIds.has(entry.id)) {
        console.log(`Server "${entry.id}" is already configured.`);
        return;
      }
      await addFromRegistry(entry);
      return;
    }
    console.log(`"${nameArg}" not found in the registry.\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('Available MCP servers:\n');

    for (let i = 0; i < MCP_REGISTRY.length; i++) {
      const entry = MCP_REGISTRY[i]!;
      const installed = existingIds.has(entry.id) ? ' (installed)' : '';
      console.log(`  ${String(i + 1).padStart(2)}. ${entry.name.padEnd(22)} ${entry.description}${installed}`);
    }

    console.log(`\n   0. Custom server`);

    const choice = await ask(rl, '\nChoose a server (number or name)', '');
    rl.close();

    if (!choice) return;

    if (choice === '0' || choice.toLowerCase() === 'custom') {
      await addCustom();
      return;
    }

    const num = parseInt(choice, 10);
    let entry: McpRegistryEntry | null = null;

    if (!isNaN(num) && num >= 1 && num <= MCP_REGISTRY.length) {
      entry = MCP_REGISTRY[num - 1]!;
    } else {
      entry = findRegistryEntry(choice);
    }

    if (!entry) {
      console.log(`"${choice}" not found.`);
      return;
    }

    if (existingIds.has(entry.id)) {
      console.log(`Server "${entry.id}" is already configured.`);
      return;
    }

    await addFromRegistry(entry);
  } catch (error) {
    if ((error as any)?.code === 'ERR_USE_AFTER_CLOSE') return;
    throw error;
  } finally {
    try { rl.close(); } catch {}
  }
}

async function addFromRegistry(entry: McpRegistryEntry): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`\nAdding ${entry.name}: ${entry.description}\n`);

    const args = [...entry.args];
    const env: Record<string, string> = {};

    if (entry.prompts) {
      for (const prompt of entry.prompts) {
        const value = await ask(rl, prompt.question);
        if (!value) {
          console.log('Cancelled.');
          return;
        }
        if (prompt.argIndex !== undefined) {
          args[prompt.argIndex] = value;
        }
      }
    }

    if (entry.env) {
      for (const [key, meta] of Object.entries(entry.env)) {
        const existing = process.env[key];
        if (existing) {
          console.log(`  ${key}: using value from environment`);
          env[key] = existing;
          continue;
        }

        const suffix = meta.required ? '' : ' (optional, press Enter to skip)';
        const value = await ask(rl, `${meta.description}${suffix}`);

        if (!value && meta.required) {
          console.log(`${key} is required. Cancelled.`);
          return;
        }

        if (value) {
          env[key] = value;
        }
      }
    }

    const config: Partial<McpServerConfig> = {
      id: entry.id,
      name: entry.name,
      command: entry.command,
      args,
      enabled: true,
      autostart: 'startup',
      approval: 'always',
      ...(Object.keys(env).length > 0 && { env }),
    };

    saveServerConfig(config);
    console.log(`\n"${entry.id}" added successfully.`);
    console.log(`Run "mosaic mcp doctor" to test connectivity.`);
  } finally {
    rl.close();
  }
}

async function addCustom(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\nCustom MCP server\n');

    const id = await ask(rl, 'Server ID');
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      console.log('Invalid server ID.');
      return;
    }

    const name = await ask(rl, 'Display name', id);
    const command = await ask(rl, 'Command (e.g., npx, node, python)');
    if (!command) {
      console.log('Command is required.');
      return;
    }

    const argsStr = await ask(rl, 'Arguments (space-separated)', '');
    const args = argsStr ? argsStr.split(/\s+/) : [];

    const config: Partial<McpServerConfig> = {
      id,
      name,
      command,
      args,
      enabled: true,
      autostart: 'startup',
      approval: 'always',
    };

    saveServerConfig(config);
    console.log(`\n"${id}" added successfully.`);
    console.log(`Run "mosaic mcp doctor" to test connectivity.`);
  } finally {
    rl.close();
  }
}