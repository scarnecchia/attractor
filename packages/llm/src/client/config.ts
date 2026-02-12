import type { ProviderAdapter } from '../types/index.js';
import type { Middleware } from '../types/index.js';

export type ProviderEnvConfig = {
  readonly envVar: string;
  readonly providerName: string;
};

export type ProviderOptionEnvConfig = {
  readonly envVar: string;
  readonly providerName: string;
  readonly option: string;
};

export type ClientConfig = {
  readonly providers: Record<string, ProviderAdapter>;
  readonly defaultProvider?: string;
  readonly middleware?: ReadonlyArray<Middleware>;
};

export const DEFAULT_PROVIDER_ENV_CONFIGS: ReadonlyArray<ProviderEnvConfig> = [
  { envVar: 'OPENAI_API_KEY', providerName: 'openai' },
  { envVar: 'ANTHROPIC_API_KEY', providerName: 'anthropic' },
  { envVar: 'GEMINI_API_KEY', providerName: 'gemini' },
  { envVar: 'GOOGLE_API_KEY', providerName: 'gemini' },
];

export const DEFAULT_PROVIDER_OPTION_ENV_CONFIGS: ReadonlyArray<ProviderOptionEnvConfig> = [
  { envVar: 'OPENAI_BASE_URL', providerName: 'openai', option: 'baseUrl' },
  { envVar: 'OPENAI_ORG_ID', providerName: 'openai', option: 'organization' },
];

export function detectProviders(): Record<string, Record<string, unknown>> {
  const providers: Record<string, Record<string, unknown>> = {};
  const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

  // Detect API keys - process in reverse order so earlier entries override later ones
  const reversedConfigs = Array.from(DEFAULT_PROVIDER_ENV_CONFIGS).reverse();
  for (const config of reversedConfigs) {
    const apiKey = env[config.envVar];
    if (apiKey && apiKey.length > 0) {
      const providerName = config.providerName;
      if (!providers[providerName]) {
        providers[providerName] = {};
      }
      const providerConfig = providers[providerName];
      if (providerConfig) {
        providerConfig['apiKey'] = apiKey;
      }
    }
  }

  // Detect provider options
  for (const config of DEFAULT_PROVIDER_OPTION_ENV_CONFIGS) {
    const value = env[config.envVar];
    if (value && value.length > 0) {
      const providerName = config.providerName;
      if (!providers[providerName]) {
        providers[providerName] = {};
      }
      const providerConfig = providers[providerName];
      if (providerConfig) {
        providerConfig[config.option] = value;
      }
    }
  }

  return providers;
}
