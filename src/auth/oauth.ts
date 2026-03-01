import http from 'http';
import { randomBytes, createHash } from 'crypto';
import { URL } from 'url';
import { createInterface } from 'readline';
import { OAuthTokenState, setOAuthTokenForProvider, setOAuthModelsForProvider, setFirstRunComplete, readConfig, getProviderById } from '../utils/config';
import { debugLog, maskToken } from '../utils/debug';

interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  redirectUri?: string;
  callbackPath?: string;
  flow: 'local' | 'manual';
  extraAuthorizeParams?: Record<string, string>;
}

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_SCOPE = 'openid profile email offline_access';
const OPENAI_CODEX_MODELS_URL = 'https://developers.openai.com/codex/models';

const OPENAI_CODEX_FALLBACK_MODELS = [
  'gpt-5.2-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5-codex',
  'gpt-5-codex-mini',
  'gpt-5.2-2025-12-11',
  'gpt-5.1-2025-11-13',
  'gpt-5-2025-08-07',
];

const GOOGLE_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  openai: {
    authorizeUrl: OPENAI_AUTHORIZE_URL,
    tokenUrl: OPENAI_TOKEN_URL,
    clientId: OPENAI_CLIENT_ID,
    scope: OPENAI_SCOPE,
    redirectUri: OPENAI_REDIRECT_URI,
    callbackPath: '/auth/callback',
    flow: 'local',
    extraAuthorizeParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    },
  },
  google: {
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    scope: GOOGLE_SCOPE,
    callbackPath: '/oauth2callback',
    flow: 'local',
    extraAuthorizeParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  },
};

function gold(text: string): string {
  return `\x1b[38;2;255;202;56m${text}\x1b[0m`;
}

function gray(text: string): string {
  return `\x1b[90m${text}\x1b[0m`;
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function openBrowser(url: string): void {
  const { exec } = require('child_process');
  const platform = process.platform;
  if (platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return base64UrlEncode(randomBytes(16));
}

function hasGoogleOAuthCredentials(): boolean {
  return GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_SECRET.length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseAuthCode(input: string): { code?: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  if (trimmed.includes('http://') || trimmed.includes('https://')) {
    try {
      const url = new URL(trimmed);
      return {
        code: url.searchParams.get('code') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
      };
    } catch {
      return {};
    }
  }
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#');
    return { code: code || undefined, state: state || undefined };
  }
  return { code: trimmed };
}

async function askInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question(prompt, (value: string) => resolve(value));
  });
  rl.close();
  return answer.trim();
}

function startLocalOAuthServer(expectedState: string, port: number, callbackPath: string = '/auth/callback'): {
  ready: boolean;
  actualPort: number;
  close: () => void;
  waitForCode: () => Promise<{ code?: string } | null>;
} {
  let lastCode: string | undefined;
  let ready = true;
  let actualPort = port;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== callbackPath) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    if (!code || !state || state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="../../docs/monoverse_white.png" type="image/png">
    <title>Monoverse Authorization Failed</title>
    <style>
        :root {
            --bg-app: #171717;
            --text-primary: #ffffff;
            --text-secondary: #aaaaaa;
            --error-color: #ff4444;
            --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        }
        @media (prefers-color-scheme: light) {
            :root {
                --bg-app: #ffffff;
                --text-primary: #1a1a1a;
                --text-secondary: #555555;
                --error-color: #dc2626;
            }
        }
        body {
            background-color: var(--bg-app);
            color: var(--text-primary);
            font-family: var(--font-family);
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        .container {
            padding: 2rem;
            animation: fadeIn 0.5s ease-out;
        }
        .logo {
            width: 80px;
            height: 80px;
            margin-bottom: 1.5rem;
            opacity: 0.8;
        }
        h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--error-color);
        }
        p {
            font-size: 1.1rem;
            color: var(--text-secondary);
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <img class="logo" src="../../docs/monoverse_white.png" alt="Monoverse Logo">
        <h1>Authorization Failed</h1>
        <p>Please return to the terminal and try again.</p>
    </div>
</body>
</html>`);
      return;
    }
    lastCode = code;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="../../docs/monoverse_white.png" type="image/png">
    <title>Monoverse Authorization</title>
    <style>
        :root {
            --bg-app: #171717;
            --text-primary: #ffffff;
            --text-secondary: #aaaaaa;
            --accent-color: #2596be;
            --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        }
        @media (prefers-color-scheme: light) {
            :root {
                --bg-app: #ffffff;
                --text-primary: #1a1a1a;
                --text-secondary: #555555;
                --accent-color: #d9a510;
            }
        }
        body {
            background-color: var(--bg-app);
            color: var(--text-primary);
            font-family: var(--font-family);
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        .container {
            padding: 2rem;
            animation: fadeIn 0.5s ease-out;
        }
        .logo {
            width: 80px;
            height: 80px;
            margin-bottom: 1.5rem;
        }
        h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }
        p {
            font-size: 1.1rem;
            color: var(--text-secondary);
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <img class="logo" src="../../docs/monoverse_white.png" alt="Monoverse Logo">
        <h1>Authorization Complete</h1>
        <p>You can close this tab and return to the terminal.</p>
    </div>
</body>
</html>`);
  });

  server.on('error', () => {
    ready = false;
  });
  try {
    server.listen(port, '127.0.0.1');
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      actualPort = addr.port;
    }
  } catch {
    ready = false;
  }

  return {
    ready,
    actualPort,
    close: () => server.close(),
    waitForCode: async () => {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        if (lastCode) return { code: lastCode };
        await sleep(500);
      }
      return null;
    },
  };
}

function buildAuthorizeUrl(config: OAuthProviderConfig, pkce: { verifier: string; challenge: string }, state: string, redirectUri?: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  const effectiveRedirect = redirectUri ?? config.redirectUri;
  if (effectiveRedirect) url.searchParams.set('redirect_uri', effectiveRedirect);
  if (config.scope) url.searchParams.set('scope', config.scope);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (config.extraAuthorizeParams) {
    for (const [key, value] of Object.entries(config.extraAuthorizeParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function exchangeAuthorizationCode(
  providerId: string,
  tokenUrl: string,
  params: Record<string, string>
): Promise<OAuthTokenState | null> {
  debugLog(`[oauth][${providerId}] exchanging authorization code`);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json() as OAuthTokenResponse;
  if (!res.ok || data.error) {
    debugLog(`[oauth][${providerId}] token exchange failed status=${res.status} error=${data.error ?? ''} desc=${data.error_description ?? ''}`);
    return null;
  }
  debugLog(`[oauth][${providerId}] token exchange ok access=${maskToken(data.access_token)} refresh=${maskToken(data.refresh_token)}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

const PERMANENT_OAUTH_ERRORS = ['invalid_client', 'invalid_grant', 'unauthorized_client', 'invalid_scope'];
const REFRESH_MAX_ATTEMPTS = 3;

async function refreshOAuthTokenGeneric(
  providerId: string,
  tokenUrl: string,
  params: Record<string, string>,
  fallbackRefreshToken: string
): Promise<OAuthTokenState | null> {
  const body = new URLSearchParams(params).toString();

  for (let attempt = 0; attempt < REFRESH_MAX_ATTEMPTS; attempt++) {
    debugLog(`[oauth][${providerId}] refresh token=${maskToken(fallbackRefreshToken)}${attempt > 0 ? ` (retry ${attempt}/${REFRESH_MAX_ATTEMPTS - 1})` : ''}`);

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      debugLog(`[oauth][${providerId}] refresh network error: ${err instanceof Error ? err.message : err}`);
      if (attempt < REFRESH_MAX_ATTEMPTS - 1) {
        await sleep((attempt + 1) * 1500);
        continue;
      }
      return null;
    }

    const data = await res.json() as OAuthTokenResponse;
    if (!res.ok || data.error) {
      debugLog(`[oauth][${providerId}] refresh failed status=${res.status} error=${data.error ?? ''} desc=${data.error_description ?? ''}`);
      if (PERMANENT_OAUTH_ERRORS.includes(data.error ?? '') || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
        return null;
      }
      if (attempt < REFRESH_MAX_ATTEMPTS - 1) {
        await sleep((attempt + 1) * 1500);
        continue;
      }
      return null;
    }

    debugLog(`[oauth][${providerId}] refresh ok access=${maskToken(data.access_token)} refresh=${maskToken(data.refresh_token)}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? fallbackRefreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };
  }
  return null;
}

async function fetchOpenAICodexModels(): Promise<string[]> {
  try {
    const res = await fetch(OPENAI_CODEX_MODELS_URL, {
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return OPENAI_CODEX_FALLBACK_MODELS;
    const text = await res.text();
    const matches = new Set<string>();
    const pattern = /codex\s+-m\s+([a-z0-9._-]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) matches.add(m[1]);
    }
    if (matches.size === 0) {
      const alt = /gpt-[a-z0-9._-]+/gi;
      while ((m = alt.exec(text)) !== null) {
        if (m[0]) matches.add(m[0]);
      }
    }
    const out = [...matches];
    return out.length > 0 ? out : OPENAI_CODEX_FALLBACK_MODELS;
  } catch {
    return OPENAI_CODEX_FALLBACK_MODELS;
  }
}

async function syncOpenAICodexModels(): Promise<Array<{ id: string; name: string; description: string }>> {
  const ids = await fetchOpenAICodexModels();
  if (ids.length === 0) return [];
  const models = ids.map(id => ({
    id,
    name: id,
    description: 'Codex model',
  }));
  setOAuthModelsForProvider('openai', models);
  return models;
}

export async function refreshOpenAIOAuthToken(refreshToken: string): Promise<OAuthTokenState | null> {
  return refreshOAuthTokenGeneric('openai', OPENAI_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
  }, refreshToken);
}

export async function refreshGoogleOAuthToken(refreshToken: string): Promise<OAuthTokenState | null> {
  if (!hasGoogleOAuthCredentials()) return null;
  return refreshOAuthTokenGeneric('google', GOOGLE_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
  }, refreshToken);
}

export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1]!;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getSupportedOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}

async function runOpenAIOAuthFlow(): Promise<boolean> {
  const config = OAUTH_PROVIDERS.openai;
  if (!config) {
    console.error('OpenAI OAuth configuration not found');
    return false;
  }
  const pkce = generatePKCE();
  const state = createState();
  const authorizeUrl = buildAuthorizeUrl(config, pkce, state);
  debugLog(`[oauth][openai] authorize url=${authorizeUrl}`);

  console.log('');
  console.log(gold('Mosaic OAuth Login'));
  console.log(gray('Provider: openai'));
  console.log('');

  const server = startLocalOAuthServer(state, 1455, config.callbackPath);
  if (server.ready) {
    try {
      openBrowser(authorizeUrl);
      console.log(gray('Browser opened automatically.'));
    } catch {
      console.log(gray('Open the URL below manually.'));
      console.log(`  ${bold(authorizeUrl)}`);
    }
    const result = await server.waitForCode();
    server.close();
    if (result?.code) {
      const tokens = await exchangeAuthorizationCode('openai', OPENAI_TOKEN_URL, {
        grant_type: 'authorization_code',
        client_id: OPENAI_CLIENT_ID,
        code: result.code,
        code_verifier: pkce.verifier,
        redirect_uri: OPENAI_REDIRECT_URI,
      });
      if (!tokens) return false;
      setOAuthTokenForProvider('openai', tokens);
      const models = await syncOpenAICodexModels();
      autoSetupProvider('openai', models);
      console.log('');
      console.log(gold('Authorized successfully!'));
      console.log(gray('Token stored for provider "openai".'));
      return true;
    }
  }

  console.log('');
  console.log(gray('Manual OAuth required.'));
  console.log(`Open this URL in your browser:\n`);
  console.log(`  ${bold(authorizeUrl)}`);
  console.log('');
  const input = await askInput('Paste the redirect URL (or code): ');
  const parsed = parseAuthCode(input);
  if (!parsed.code) return false;
  const tokens = await exchangeAuthorizationCode('openai', OPENAI_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: OPENAI_CLIENT_ID,
    code: parsed.code,
    code_verifier: pkce.verifier,
    redirect_uri: OPENAI_REDIRECT_URI,
  });
  if (!tokens) return false;
  setOAuthTokenForProvider('openai', tokens);
  const models = await syncOpenAICodexModels();
  autoSetupProvider('openai', models);
  console.log('');
  console.log(gold('Authorized successfully!'));
  console.log(gray('Token stored for provider "openai".'));
  return true;
}

async function runGoogleOAuthFlow(): Promise<boolean> {
  const config = OAUTH_PROVIDERS.google;
  if (!config) {
    console.error('Google OAuth configuration not found');
    return false;
  }
  if (!hasGoogleOAuthCredentials()) {
    console.error('Google OAuth credentials are missing. Set MOSAIC_GOOGLE_CLIENT_ID and MOSAIC_GOOGLE_CLIENT_SECRET.');
    return false;
  }
  const pkce = generatePKCE();
  const state = createState();

  console.log('');
  console.log(gold('Mosaic OAuth Login'));
  console.log(gray('Provider: google'));
  console.log('');

  const server = startLocalOAuthServer(state, 0, config.callbackPath);
  if (!server.ready) {
    console.error('Failed to start local OAuth server');
    return false;
  }

  const redirectUri = `http://127.0.0.1:${server.actualPort}${config.callbackPath}`;
  const authorizeUrl = buildAuthorizeUrl(config, pkce, state, redirectUri);
  debugLog(`[oauth][google] authorize url=${authorizeUrl}`);

  try {
    openBrowser(authorizeUrl);
    console.log(gray('Browser opened automatically.'));
  } catch {
    console.log(gray('Open the URL below manually.'));
    console.log(`  ${bold(authorizeUrl)}`);
  }

  const result = await server.waitForCode();
  server.close();

  if (!result?.code) {
    console.log('');
    console.log(gray('Manual OAuth required.'));
    console.log(`Open this URL in your browser:\n`);
    console.log(`  ${bold(authorizeUrl)}`);
    console.log('');
    const input = await askInput('Paste the redirect URL (or code): ');
    const parsed = parseAuthCode(input);
    if (!parsed.code) return false;
    const tokens = await exchangeAuthorizationCode('google', GOOGLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: parsed.code,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens) return false;
    setOAuthTokenForProvider('google', tokens);
    autoSetupProvider('google', []);
    console.log('');
    console.log(gold('Authorized successfully!'));
    console.log(gray('Token stored for provider "google".'));
    return true;
  }

  const tokens = await exchangeAuthorizationCode('google', GOOGLE_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code: result.code,
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri,
  });
  if (!tokens) return false;
  setOAuthTokenForProvider('google', tokens);
  autoSetupProvider('google', []);
  console.log('');
  console.log(gold('Authorized successfully!'));
  console.log(gray('Token stored for provider "google".'));
  return true;
}

function autoSetupProvider(providerId: string, models: Array<{ id: string }>) {
  const config = readConfig();
  let targetModel = models[0]?.id;
  if (!targetModel) {
    const provider = getProviderById(providerId);
    targetModel = provider?.models[0]?.id;
  }
  if (!targetModel) return;
  const needsSetup = config.firstRun !== false || config.provider !== providerId || !config.model;
  if (!needsSetup) return;
  setFirstRunComplete(providerId, targetModel);
}

export async function runOAuthFlow(providerId: string): Promise<boolean> {
  if (providerId === 'openai') return runOpenAIOAuthFlow();
  if (providerId === 'google') return runGoogleOAuthFlow();
  console.error(`OAuth is not configured for provider "${providerId}".`);
  console.error(`Supported providers: ${getSupportedOAuthProviders().join(', ')}`);
  return false;
}
