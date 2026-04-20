import { createHash } from 'crypto';
import { generateText } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import { MosaicConfig, readConfig, writeConfig } from '../../utils/config';
import { debugLog } from '../../utils/debug';

export type MistralBackend = "generic-api" | "codestral-domain";

export function isCodestralModel(model: string): boolean {
  return /^codestral(-|$)/i.test(model.trim());
}

export function getMistralCodestralAuthError(model: string): string | null {
  if (isCodestralModel(model)) {
    return null;
  }
  return `This key appears to be Codestral-only and cannot be used with ${model}. Use codestral-latest or configure a Mistral API key.`;
}

function computeKeyFingerprint(apiKey: string): string {
  const normalized = apiKey.trim();
  return createHash('sha256').update(normalized).digest('hex');
}

const probePromiseCache = new Map<string, Promise<MistralBackend>>();

export async function resolveMistralBackendForKey(
  config: MosaicConfig,
  apiKey: string | undefined
): Promise<MistralBackend> {
  if (!apiKey) {
    return "generic-api";
  }

  const normalized = apiKey.trim().replace(/[\r\n]+/g, '');
  const fingerprint = computeKeyFingerprint(normalized);
  const fingerprintPrefix = fingerprint.substring(0, 8);

  const cachedResult = config.mistralResolvedBackendByKey?.[fingerprint];
  if (cachedResult) {
    debugLog(`[mistral-auth] key=${fingerprintPrefix} source=cache backend=${cachedResult}`);
    return cachedResult;
  }

  const existingProbe = probePromiseCache.get(fingerprint);
  if (existingProbe) {
    return existingProbe;
  }

  const probePromise = (async (): Promise<MistralBackend> => {
    debugLog(`[mistral-auth] key=${fingerprintPrefix} source=probe starting...`);

    let genericSuccess = false;
    let codestralSuccess = false;
    let genericError: any = null;
    let codestralError: any = null;

    // Probe A: Generic Mistral API
    try {
      const mistral = createMistral({ apiKey: normalized, baseURL: 'https://api.mistral.ai/v1' });
      await generateText({
        model: mistral('mistral-small-latest'),
        prompt: 'hi',
        maxTokens: 1,
      });
      genericSuccess = true;
    } catch (err: any) {
      genericError = err;
      debugLog(`[mistral-auth] key=${fingerprintPrefix} generic-api probe failed: ${err.message}`);
    }

    if (genericSuccess) {
      persistResolvedBackend(fingerprint, "generic-api");
      debugLog(`[mistral-auth] key=${fingerprintPrefix} source=probe generic-api=success codestral-domain=not-probed resolved=generic-api`);
      return "generic-api";
    }

    // Probe B: Codestral Domain
    try {
      const mistral = createMistral({ apiKey: normalized, baseURL: 'https://codestral.mistral.ai/v1' });
      await generateText({
        model: mistral('codestral-latest'),
        prompt: 'hi',
        maxTokens: 1,
      });
      codestralSuccess = true;
    } catch (err: any) {
      codestralError = err;
      debugLog(`[mistral-auth] key=${fingerprintPrefix} codestral-domain probe failed: ${err.message}`);
    }

    if (codestralSuccess) {
      persistResolvedBackend(fingerprint, "codestral-domain");
      debugLog(`[mistral-auth] key=${fingerprintPrefix} source=probe generic-api=fail codestral-domain=success resolved=codestral-domain`);
      return "codestral-domain";
    }

    // Cleanup cache on failure if you want, or just leave it. If we return error, user might retry.
    probePromiseCache.delete(fingerprint);

    // If both failed with unauthorized/access errors, surface a precise error
    const isGenericUnauthorized = genericError?.status === 401 || genericError?.message?.toLowerCase().includes('unauthorized') || genericError?.message?.toLowerCase().includes('invalid api key');
    const isCodestralUnauthorized = codestralError?.status === 401 || codestralError?.message?.toLowerCase().includes('unauthorized') || codestralError?.message?.toLowerCase().includes('invalid api key');

    if (isGenericUnauthorized && isCodestralUnauthorized) {
      throw new Error(`This Mistral API key could not be validated for either generic Mistral or Codestral access. Check your API key, endpoint compatibility, and model permissions.`);
    }

    // If both fail for other reasons (network, etc), throw transient error
    throw new Error(`Transient error validating Mistral API key: Generic fail (${genericError?.message}), Codestral fail (${codestralError?.message}). Please try again later.`);
  })();

  probePromiseCache.set(fingerprint, probePromise);
  return probePromise;
}

function persistResolvedBackend(fingerprint: string, backend: MistralBackend) {
  const config = readConfig();
  if (!config.mistralResolvedBackendByKey) {
    config.mistralResolvedBackendByKey = {};
  }
  config.mistralResolvedBackendByKey[fingerprint] = backend;
  writeConfig(config);
}
