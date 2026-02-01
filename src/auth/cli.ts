import {
  getApiKeyForProvider,
  setApiKeyForProvider,
  removeApiKeyForProvider,
  getStoredProviderIds,
  getAllProviders,
  getOAuthTokenForProvider,
  removeOAuthTokenForProvider,
} from '../utils/config';
import { runOAuthFlow, getSupportedOAuthProviders } from './oauth';

function gold(text: string): string {
  return `\x1b[38;2;255;202;56m${text}\x1b[0m`;
}

function gray(text: string): string {
  return `\x1b[90m${text}\x1b[0m`;
}

function mask(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function showAuthHelp(): void {
  console.log('');
  console.log(`
${gold('Mosaic Auth')}

${gold('Usage')}
  $ mosaic auth <command> [options]

${gold('Commands')}
  list                              ${gray('List stored credentials (masked)')}
  set --provider <id> --token <key> ${gray('Add or update an API key')}
  remove --provider <id>            ${gray('Remove stored credentials')}
  login <provider>                  ${gray('OAuth login')}
  help                              ${gray('Show this help message')}

${gold('Shortcuts')}
  mosaic auth --provider <id> --token <key>  ${gray('Same as: mosaic auth set ...')}
  mosaic auth --oauth <provider>             ${gray('Same as: mosaic auth login ...')}

${gold('Examples')}
  ${gray('mosaic auth set --provider openai --token sk-abc123')}
  ${gray('mosaic auth list')}
  ${gray('mosaic auth remove --provider anthropic')}
  ${gray('mosaic auth login openai')}
`);
}

function authList(): void {
  const ids = getStoredProviderIds();
  const providers = getAllProviders();

  if (ids.length === 0) {
    console.log(gray('No credentials stored.'));
    return;
  }

  console.log('');
  console.log(gold('Stored credentials:'));
  console.log('');
  for (const id of ids) {
    const key = getApiKeyForProvider(id);
    const oauth = getOAuthTokenForProvider(id);
    const provider = providers.find(p => p.id === id);
    const name = provider ? provider.name : id;
    if (oauth?.accessToken) {
      console.log(`  ${name} (${id}): oauth ${mask(oauth.accessToken)}`);
    } else {
      console.log(`  ${name} (${id}): ${key ? mask(key) : gray('empty')}`);
    }
  }
  console.log('');
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

export async function runAuthCli(args: string[]): Promise<void> {
  if (args.length === 0) {
    showAuthHelp();
    return;
  }

  const subcommand = args[0]!;

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showAuthHelp();
    return;
  }

  if (subcommand === 'list') {
    authList();
    return;
  }

  if (subcommand === 'set') {
    const providerId = parseFlag(args, '--provider');
    const token = parseFlag(args, '--token');
    if (!providerId || !token) {
      console.error('Usage: mosaic auth set --provider <id> --token <key>');
      process.exit(1);
    }
    setApiKeyForProvider(providerId, token);
    console.log(gold(`API key set for "${providerId}".`));
    return;
  }

  if (subcommand === 'remove') {
    const providerId = parseFlag(args, '--provider');
    if (!providerId) {
      console.error('Usage: mosaic auth remove --provider <id>');
      process.exit(1);
    }
    removeApiKeyForProvider(providerId);
    removeOAuthTokenForProvider(providerId);
    console.log(gold(`Credentials removed for "${providerId}".`));
    return;
  }

  if (subcommand === 'login') {
    const providerId = args[1];
    if (!providerId) {
      const supported = getSupportedOAuthProviders();
      console.error(`Usage: mosaic auth login <provider>`);
      console.error(`Supported: ${supported.join(', ')}`);
      process.exit(1);
    }
    const success = await runOAuthFlow(providerId);
    process.exit(success ? 0 : 1);
  }

  if (subcommand === '--provider' || subcommand === '--token') {
    const providerId = parseFlag(args, '--provider');
    const token = parseFlag(args, '--token');
    if (providerId && token) {
      setApiKeyForProvider(providerId, token);
      console.log(gold(`API key set for "${providerId}".`));
      return;
    }
    console.error('Usage: mosaic auth --provider <id> --token <key>');
    process.exit(1);
  }

  if (subcommand === '--oauth') {
    const providerId = args[1];
    if (!providerId) {
      console.error('Usage: mosaic auth --oauth <provider>');
      process.exit(1);
    }
    const success = await runOAuthFlow(providerId);
    process.exit(success ? 0 : 1);
  }

  console.error(`Unknown auth command: "${subcommand}". Run "mosaic auth help" for usage.`);
  process.exit(1);
}
