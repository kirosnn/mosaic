import { describe, expect, it } from 'bun:test';
import { startLocalOAuthCallbackServer } from '../oauth';

describe('oauth callback server', () => {
  it('waits for a valid callback and redirects the browser on success', async () => {
    let callbackHandled = false;
    const server = await startLocalOAuthCallbackServer({
      providerId: 'google',
      expectedState: 'expected-state',
      port: 0,
      callbackPath: '/oauth2callback',
      onValidCallback: async ({ code, state }) => {
        callbackHandled = code === 'auth-code' && state === 'expected-state';
        return {
          response: {
            type: 'redirect',
            location: 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini',
          },
          result: true,
        };
      },
    });

    const response = await fetch(`http://127.0.0.1:${server.actualPort}/oauth2callback?code=auth-code&state=expected-state`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://developers.google.com/gemini-code-assist/auth/auth_success_gemini');
    expect(await server.waitForResult(1000)).toBe(true);
    expect(callbackHandled).toBe(true);
  });

  it('returns a local error page when state is invalid', async () => {
    const server = await startLocalOAuthCallbackServer({
      providerId: 'google',
      expectedState: 'expected-state',
      port: 0,
      callbackPath: '/oauth2callback',
      onValidCallback: async () => ({
        response: {
          type: 'redirect',
          location: 'https://example.com/should-not-happen',
        },
        result: true,
      }),
    });

    const response = await fetch(`http://127.0.0.1:${server.actualPort}/oauth2callback?code=auth-code&state=wrong-state`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('OAuth state parameter is invalid');
    expect(await server.waitForResult(1000)).toBeNull();
  });

  it('returns the real local failure reason when callback processing fails', async () => {
    const server = await startLocalOAuthCallbackServer({
      providerId: 'google',
      expectedState: 'expected-state',
      port: 0,
      callbackPath: '/oauth2callback',
      onValidCallback: async () => ({
        response: {
          type: 'html',
          statusCode: 502,
          title: 'Authorization Failed',
          message: 'Google token exchange failed. Return to the terminal and try again.',
          detail: 'status=400 error=invalid_grant description=Bad verification code',
        },
        result: false,
      }),
    });

    const response = await fetch(`http://127.0.0.1:${server.actualPort}/oauth2callback?code=auth-code&state=expected-state`);
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain('Google token exchange failed');
    expect(body).toContain('invalid_grant');
    expect(await server.waitForResult(1000)).toBe(false);
  });
});
