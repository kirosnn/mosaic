import http from 'http';
import { randomBytes, createHash } from 'crypto';
import { URL } from 'url';
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { OAuthTokenState, OPENAI_CHATGPT_OAUTH_ALLOWED_MODEL_IDS, isSupportedOpenAIOAuthCatalogModelId, setOAuthTokenForProvider, setOAuthModelsForProvider, setFirstRunComplete, readConfig, getProviderById } from '../utils/config';
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
export const OPENAI_CHATGPT_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const OPENAI_CODEX_CACHE_PATH = join(homedir(), '.codex', 'models_cache.json');

interface CachedCodexModel {
  slug?: string;
  supported_in_api?: boolean;
}

interface CachedCodexModelsPayload {
  models?: CachedCodexModel[];
}

const GOOGLE_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'openai-oauth': {
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
  'google-oauth': {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOAuthPageHtml(title: string, message: string, kind: 'success' | 'error', detail?: string): string {
  const headingColor = kind === 'success' ? 'var(--text-primary)' : 'var(--error-color)';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetail = detail ? `<pre>${escapeHtml(detail)}</pre>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
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
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        .container {
            padding: 2rem;
            max-width: 720px;
            animation: fadeIn 0.5s ease-out;
        }
        .logo {
            width: 80px;
            height: 80px;
            margin-bottom: 1.5rem;
            opacity: 0.9;
        }
        h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: ${headingColor};
        }
        p {
            font-size: 1.05rem;
            color: var(--text-secondary);
        }
        pre {
            margin-top: 1rem;
            padding: 1rem;
            text-align: left;
            white-space: pre-wrap;
            word-break: break-word;
            background: rgba(255,255,255,0.06);
            border-radius: 10px;
            color: var(--text-primary);
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <svg class="logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 40 C 20 20, 40 20, 50 40 S 80 60, 90 40" fill="var(--text-primary)"/>
            <path d="M10 60 C 20 40, 40 40, 50 60 S 80 80, 90 60" fill="var(--text-primary)"/>
        </svg>
        <h1>${safeTitle}</h1>
        <p>${safeMessage}</p>
        ${safeDetail}
    </div>
</body>
</html>`;
}

interface OAuthBrowserResult<T> {
  response:
    | { type: 'redirect'; location: string }
    | { type: 'html'; statusCode: number; title: string; message: string; detail?: string };
  result: T;
}

interface LocalOAuthCallbackServer<T> {
  actualPort: number;
  close: () => Promise<void>;
  waitForResult: (timeoutMs?: number) => Promise<T | null>;
}

interface LocalOAuthCallbackContext {
  code?: string;
  state?: string;
  url: URL;
}

export async function startLocalOAuthCallbackServer<T>(options: {
  providerId: string;
  expectedState: string;
  port: number;
  callbackPath: string;
  onValidCallback: (context: LocalOAuthCallbackContext) => Promise<OAuthBrowserResult<T>>;
}): Promise<LocalOAuthCallbackServer<T>> {
  let actualPort = options.port;
  let handled = false;
  let closed = false;
  let resolveResult!: (value: T | null) => void;
  const resultPromise = new Promise<T | null>((resolve) => {
    resolveResult = resolve;
  });

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || `127.0.0.1:${actualPort}`;
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== options.callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    debugLog(`[oauth][${options.providerId}] callback received path=${url.pathname} query=${url.search}`);

    if (handled) {
      res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildOAuthPageHtml('Authorization Already Processed', 'This OAuth callback was already handled. Return to the terminal.', 'error'));
      return;
    }
    handled = true;

    const finalize = (result: T | null) => {
      res.once('finish', () => {
        resolveResult(result);
        void closeServer();
      });
    };

    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;

    if (!code) {
      debugLog(`[oauth][${options.providerId}] callback rejected missing_code`);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      finalize(null);
      res.end(buildOAuthPageHtml('Authorization Failed', 'The OAuth callback is missing the authorization code.', 'error'));
      return;
    }

    if (!state || state !== options.expectedState) {
      debugLog(`[oauth][${options.providerId}] state rejected expected=${options.expectedState} actual=${state ?? ''}`);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      finalize(null);
      res.end(buildOAuthPageHtml('Authorization Failed', 'The OAuth state parameter is invalid.', 'error', `Expected: ${options.expectedState}\nReceived: ${state ?? '(missing)'}`));
      return;
    }

    debugLog(`[oauth][${options.providerId}] state validated`);

    try {
      const outcome = await options.onValidCallback({ code, state, url });
      if (outcome.response.type === 'redirect') {
        debugLog(`[oauth][${options.providerId}] redirect sent to browser location=${outcome.response.location}`);
        res.writeHead(302, { Location: outcome.response.location });
        finalize(outcome.result);
        res.end();
        return;
      }

      res.writeHead(outcome.response.statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
      finalize(outcome.result);
      res.end(buildOAuthPageHtml(
        outcome.response.title,
        outcome.response.message,
        outcome.response.statusCode >= 400 ? 'error' : 'success',
        outcome.response.detail,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog(`[oauth][${options.providerId}] callback handling failed error=${message}`);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      finalize(null);
      res.end(buildOAuthPageHtml('Authorization Failed', 'The local callback failed while processing the OAuth response.', 'error', message));
    }
  });

  const closeServer = () => new Promise<void>((resolve) => {
    if (closed) {
      resolve();
      return;
    }
    closed = true;
    debugLog(`[oauth][${options.providerId}] callback server shutdown requested`);
    server.close(() => {
      debugLog(`[oauth][${options.providerId}] callback server shutdown complete`);
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        actualPort = addr.port;
      }
      debugLog(`[oauth][${options.providerId}] callback server started`);
      debugLog(`[oauth][${options.providerId}] callback server listening address=http://127.0.0.1:${actualPort}${options.callbackPath}`);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, '127.0.0.1');
  });

  return {
    actualPort,
    close: closeServer,
    waitForResult: async (timeoutMs = 60000) => {
      const timeout = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      });
      const result = await Promise.race([resultPromise, timeout]);
      if (result === null) {
        await closeServer();
      }
      return result;
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
  const result = await exchangeAuthorizationCodeDetailed(providerId, tokenUrl, params);
  return result.ok ? result.tokens : null;
}

async function exchangeAuthorizationCodeDetailed(
  providerId: string,
  tokenUrl: string,
  params: Record<string, string>
): Promise<
  | { ok: true; tokens: OAuthTokenState }
  | { ok: false; reason: string }
> {
  debugLog(`[oauth][${providerId}] exchanging authorization code`);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json() as OAuthTokenResponse;
  if (!res.ok || data.error) {
    debugLog(`[oauth][${providerId}] token exchange failed status=${res.status} error=${data.error ?? ''} desc=${data.error_description ?? ''}`);
    return {
      ok: false,
      reason: `status=${res.status} error=${data.error ?? 'unknown_error'} description=${data.error_description ?? 'none'}`,
    };
  }
  debugLog(`[oauth][${providerId}] token exchange ok access=${maskToken(data.access_token)} refresh=${maskToken(data.refresh_token)}`);
  return {
    ok: true,
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    },
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

function readOpenAICodexModelsFromCache(): string[] {
  try {
    const raw = readFileSync(OPENAI_CODEX_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CachedCodexModelsPayload;
    return (parsed.models ?? [])
      .filter(model => model.supported_in_api !== false && typeof model.slug === 'string' && model.slug.trim().length > 0)
      .map(model => model.slug!.trim());
  } catch {
    return [];
  }
}

async function syncOpenAICodexModels(): Promise<Array<{ id: string; name: string; description: string }>> {
  const ids = Array.from(new Set([
    ...OPENAI_CHATGPT_OAUTH_ALLOWED_MODEL_IDS,
    ...readOpenAICodexModelsFromCache(),
  ]));
  if (ids.length === 0) return [];
  const models = ids
    .filter(id => isSupportedOpenAIOAuthCatalogModelId(id))
    .map(id => ({
      id,
      name: id,
      description: 'OpenAI OAuth model',
    }));
  setOAuthModelsForProvider('openai-oauth', models);
  return models;
}

export async function refreshOpenAIOAuthToken(refreshToken: string): Promise<OAuthTokenState | null> {
  return refreshOAuthTokenGeneric('openai-oauth', OPENAI_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
  }, refreshToken);
}

export async function refreshGoogleOAuthToken(refreshToken: string): Promise<OAuthTokenState | null> {
  if (!hasGoogleOAuthCredentials()) return null;
  return refreshOAuthTokenGeneric('google-oauth', GOOGLE_TOKEN_URL, {
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

export function getOpenAIChatGPTAccountId(token: string): string | undefined {
  const payload = decodeJwt(token);
  if (!payload) return undefined;

  const direct = payload.chatgpt_account_id;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  const auth = payload['https://api.openai.com/auth'];
  if (auth && typeof auth === 'object' && auth !== null) {
    const nested = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof nested === 'string' && nested.length > 0) {
      return nested;
    }
  }

  return undefined;
}

export function getSupportedOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}

async function runOpenAIOAuthFlow(): Promise<boolean> {
  const providerId = 'openai-oauth';
  const config = OAUTH_PROVIDERS[providerId];
  if (!config) {
    console.error('OpenAI OAuth configuration not found');
    return false;
  }
  const pkce = generatePKCE();
  const state = createState();
  const authorizeUrl = buildAuthorizeUrl(config, pkce, state);
  debugLog(`[oauth][${providerId}] authorize url=${authorizeUrl}`);

  console.log('');
  console.log(gold('Mosaic OAuth Login'));
  console.log(gray(`Provider: ${providerId}`));
  console.log('');

  try {
    const server = await startLocalOAuthCallbackServer<{ code: string } | null>({
      providerId,
      expectedState: state,
      port: 1455,
      callbackPath: config.callbackPath ?? '/auth/callback',
      onValidCallback: async ({ code }) => ({
        response: {
          type: 'html',
          statusCode: 200,
          title: 'Authorization Complete',
          message: 'You can close this tab and return to the terminal.',
        },
        result: code ? { code } : null,
      }),
    });
    try {
      debugLog(`[oauth][${providerId}] browser launch`);
      openBrowser(authorizeUrl);
      console.log(gray('Browser opened automatically.'));
    } catch {
      console.log(gray('Open the URL below manually.'));
      console.log(`  ${bold(authorizeUrl)}`);
    }
    const result = await server.waitForResult();
    if (result?.code) {
      const tokens = await exchangeAuthorizationCode(providerId, OPENAI_TOKEN_URL, {
        grant_type: 'authorization_code',
        client_id: OPENAI_CLIENT_ID,
        code: result.code,
        code_verifier: pkce.verifier,
        redirect_uri: OPENAI_REDIRECT_URI,
      });
      if (!tokens) return false;
      setOAuthTokenForProvider(providerId, tokens);
      const models = await syncOpenAICodexModels();
      autoSetupProvider(providerId, models);
      console.log('');
      console.log(gold('Authorized successfully!'));
      console.log(gray(`Token stored for provider "${providerId}".`));
      return true;
    }
  } catch (error) {
    debugLog(`[oauth][${providerId}] local callback flow failed error=${error instanceof Error ? error.message : error}`);
  }

  console.log('');
  console.log(gray('Manual OAuth required.'));
  console.log(`Open this URL in your browser:\n`);
  console.log(`  ${bold(authorizeUrl)}`);
  console.log('');
  const input = await askInput('Paste the redirect URL (or code): ');
  const parsed = parseAuthCode(input);
  if (!parsed.code) return false;
  const tokens = await exchangeAuthorizationCode(providerId, OPENAI_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: OPENAI_CLIENT_ID,
    code: parsed.code,
    code_verifier: pkce.verifier,
    redirect_uri: OPENAI_REDIRECT_URI,
  });
  if (!tokens) return false;
  setOAuthTokenForProvider(providerId, tokens);
  const models = await syncOpenAICodexModels();
  autoSetupProvider(providerId, models);
  console.log('');
  console.log(gold('Authorized successfully!'));
  console.log(gray(`Token stored for provider "${providerId}".`));
  return true;
}

async function runGoogleOAuthFlow(): Promise<boolean> {
  const providerId = 'google-oauth';
  const config = OAUTH_PROVIDERS[providerId];
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
  console.log(gray(`Provider: ${providerId}`));
  console.log('');

  const serverPort = 0;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  const hl = locale.startsWith('fr') ? 'fr' : 'en';
  const successRedirectUrl = `https://developers.google.com/gemini-code-assist/auth/auth_success_gemini?hl=${hl}`;

  let server: LocalOAuthCallbackServer<boolean>;
  try {
    server = await startLocalOAuthCallbackServer<boolean>({
      providerId,
      expectedState: state,
      port: serverPort,
      callbackPath: config.callbackPath ?? '/oauth2callback',
      onValidCallback: async ({ code }) => {
        debugLog(`[oauth][${providerId}] token exchange started`);
        const redirectUri = `http://127.0.0.1:${server.actualPort}${config.callbackPath}`;
        const exchange = await exchangeAuthorizationCodeDetailed(providerId, GOOGLE_TOKEN_URL, {
          grant_type: 'authorization_code',
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code: code ?? '',
          code_verifier: pkce.verifier,
          redirect_uri: redirectUri,
        });
        if (!exchange.ok) {
          debugLog(`[oauth][${providerId}] token exchange failed reason=${exchange.reason}`);
          return {
            response: {
              type: 'html',
              statusCode: 502,
              title: 'Authorization Failed',
              message: 'Google token exchange failed. Return to the terminal and try again.',
              detail: exchange.reason,
            },
            result: false,
          };
        }
        debugLog(`[oauth][${providerId}] token exchange succeeded`);
        setOAuthTokenForProvider(providerId, exchange.tokens);
        autoSetupProvider(providerId, []);
        return {
          response: {
            type: 'redirect',
            location: successRedirectUrl,
          },
          result: true,
        };
      },
    });
  } catch (error) {
    debugLog(`[oauth][${providerId}] callback server failed to start error=${error instanceof Error ? error.message : error}`);
    console.error('Failed to start local OAuth server');
    return false;
  }

  const redirectUri = `http://127.0.0.1:${server.actualPort}${config.callbackPath}`;
  const authorizeUrl = buildAuthorizeUrl(config, pkce, state, redirectUri);
  debugLog(`[oauth][${providerId}] authorize url=${authorizeUrl}`);

  try {
    debugLog(`[oauth][${providerId}] browser launch`);
    openBrowser(authorizeUrl);
    console.log(gray('Browser opened automatically.'));
  } catch {
    console.log(gray('Open the URL below manually.'));
    console.log(`  ${bold(authorizeUrl)}`);
  }

  const result = await server.waitForResult();
  if (result === null) {
    console.log('');
    console.log(gray('Manual OAuth required.'));
    console.log(`Open this URL in your browser:\n`);
    console.log(`  ${bold(authorizeUrl)}`);
    console.log('');
    const input = await askInput('Paste the redirect URL (or code): ');
    const parsed = parseAuthCode(input);
    if (!parsed.code) return false;
    const tokens = await exchangeAuthorizationCode(providerId, GOOGLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: parsed.code,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens) return false;
    setOAuthTokenForProvider(providerId, tokens);
    autoSetupProvider(providerId, []);
    console.log('');
    console.log(gold('Authorized successfully!'));
    console.log(gray(`Token stored for provider "${providerId}".`));
    return true;
  }

  if (!result) return false;
  console.log('');
  console.log(gold('Authorized successfully!'));
  console.log(gray(`Token stored for provider "${providerId}".`));
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
  if (providerId === 'openai-oauth') return runOpenAIOAuthFlow();
  if (providerId === 'google-oauth') return runGoogleOAuthFlow();
  
  // Legacy fallback if called with old IDs
  if (providerId === 'openai') return runOpenAIOAuthFlow();
  if (providerId === 'google') return runGoogleOAuthFlow();

  console.error(`OAuth is not configured for provider "${providerId}".`);
  console.error(`Supported providers: ${getSupportedOAuthProviders().join(', ')}`);
  return false;
}
