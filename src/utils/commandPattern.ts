const ASSIGNMENT_TOKEN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

const PACKAGE_MANAGER_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '--prefix',
  '--config',
  '--workspace',
  '-w',
  '--filter',
  '--dir',
  '--cwd',
]);

const PYTHON_OPTIONS_WITH_VALUE = new Set([
  '-c',
  '--check-hash-based-pycs',
  '-W',
  '-X',
]);

const INTERPRETER_OPTIONS_WITH_VALUE = new Set([
  '-e',
  '--eval',
  '-c',
]);

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isOptionToken(token: string): boolean {
  if (!token) return false;
  if (token === '-' || token === '--') return false;
  return token.startsWith('-');
}

function optionConsumesValue(token: string, optionsWithValue: Set<string>): boolean {
  if (!isOptionToken(token)) return false;
  const name = token.split('=')[0] ?? token;
  if (!optionsWithValue.has(name)) return false;
  return !token.includes('=');
}

function findTokenAfterOptions(tokens: string[], startIndex: number, optionsWithValue: Set<string>): number {
  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (!token || token === '--') continue;
    if (isOptionToken(token)) {
      if (optionConsumesValue(token, optionsWithValue) && i + 1 < tokens.length) {
        i += 1;
      }
      continue;
    }
    return i;
  }
  return -1;
}

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const input = command.trim();
  if (!input) return tokens;

  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? '';
    const next = input[i + 1] ?? '';

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && quote !== '\'') {
      const shouldEscape = quote === '"'
        ? (next === '"' || next === '\\' || next === '$' || next === '`')
        : (next === '"' || next === '\'' || next === '\\' || /\s/.test(next));
      if (shouldEscape) {
        escaped = true;
        continue;
      }
      current += ch;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function getCommandTokenIndex(tokens: string[]): number {
  let index = 0;
  while (index < tokens.length && ASSIGNMENT_TOKEN_PATTERN.test(tokens[index] ?? '')) {
    index++;
  }
  return index;
}

export function getBaseCommand(command: string): string {
  const normalized = normalizeWhitespace(command);
  if (!normalized) return '';

  const tokens = tokenizeCommand(normalized);
  if (tokens.length === 0) return normalized;

  const commandIndex = getCommandTokenIndex(tokens);
  if (commandIndex >= tokens.length) return tokens[0] ?? normalized;

  const commandToken = tokens[commandIndex] ?? '';
  if (!commandToken) return normalized;
  const commandName = commandToken.toLowerCase();

  const withSuffix = (suffix: string[]): string => normalizeWhitespace([commandToken, ...suffix].join(' '));

  if (commandName === 'git') {
    const subIndex = findTokenAfterOptions(tokens, commandIndex + 1, GIT_OPTIONS_WITH_VALUE);
    if (subIndex >= 0) {
      const sub = tokens[subIndex] ?? '';
      if (sub) return withSuffix([sub]);
    }
    return commandToken;
  }

  if (commandName === 'npm' || commandName === 'pnpm' || commandName === 'bun' || commandName === 'yarn') {
    const subIndex = findTokenAfterOptions(tokens, commandIndex + 1, PACKAGE_MANAGER_OPTIONS_WITH_VALUE);
    if (subIndex < 0) return commandToken;
    const sub = tokens[subIndex] ?? '';
    if (!sub) return commandToken;
    const subLower = sub.toLowerCase();

    if (subLower === 'run' || subLower === 'exec' || subLower === 'dlx') {
      const targetIndex = findTokenAfterOptions(tokens, subIndex + 1, new Set<string>());
      if (targetIndex >= 0) {
        const target = tokens[targetIndex] ?? '';
        if (target) return withSuffix([sub, target]);
      }
    }

    return withSuffix([sub]);
  }

  if (commandName === 'python' || commandName === 'python3') {
    for (let i = commandIndex + 1; i < tokens.length; i++) {
      const token = tokens[i] ?? '';
      if (!token || token === '--') continue;
      if (token === '-m' || token === '--module') {
        const moduleToken = tokens[i + 1] ?? '';
        if (moduleToken) return withSuffix([token, moduleToken]);
        return withSuffix([token]);
      }
      if (isOptionToken(token)) {
        if (optionConsumesValue(token, PYTHON_OPTIONS_WITH_VALUE) && i + 1 < tokens.length) {
          i += 1;
        }
        continue;
      }
      return withSuffix([token]);
    }
    return commandToken;
  }

  if (
    commandName === 'node'
    || commandName === 'deno'
    || commandName === 'ruby'
    || commandName === 'php'
    || commandName === 'perl'
    || commandName === 'bash'
    || commandName === 'sh'
    || commandName === 'zsh'
    || commandName === 'pwsh'
    || commandName === 'powershell'
  ) {
    const nextIndex = findTokenAfterOptions(tokens, commandIndex + 1, INTERPRETER_OPTIONS_WITH_VALUE);
    if (nextIndex >= 0) {
      const next = tokens[nextIndex] ?? '';
      if (next) return withSuffix([next]);
    }
    return commandToken;
  }

  const nextIndex = findTokenAfterOptions(tokens, commandIndex + 1, new Set<string>());
  if (nextIndex >= 0) {
    const next = tokens[nextIndex] ?? '';
    if (next) return withSuffix([next]);
  }

  return commandToken;
}

