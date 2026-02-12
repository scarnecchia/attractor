import { describe, test } from 'vitest';
import { Client } from '../../src/client/index.js';
import { OpenAIAdapter } from '../../src/providers/openai/index.js';
import { AnthropicAdapter } from '../../src/providers/anthropic/index.js';
import { GeminiAdapter } from '../../src/providers/gemini/index.js';

export const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
export type TestProvider = typeof PROVIDERS[number];

const PROVIDER_ENV_VARS: Record<TestProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const PROVIDER_ADAPTER_FACTORIES: Record<TestProvider, (apiKey: string) => any> = {
  openai: (apiKey: string) => new OpenAIAdapter(apiKey),
  anthropic: (apiKey: string) => new AnthropicAdapter(apiKey),
  gemini: (apiKey: string) => new GeminiAdapter(apiKey),
};

export function skipIfNoKey(provider: TestProvider): void {
  const envVar = PROVIDER_ENV_VARS[provider];
  const apiKey = process.env[envVar];

  if (!apiKey) {
    test.skip('API key not set', () => {});
  }
}

export function createTestClient(): Client {
  const adapters: Record<string, any> = {};
  let hasAnyAdapter = false;

  for (const provider of PROVIDERS) {
    const envVar = PROVIDER_ENV_VARS[provider];
    const apiKey = process.env[envVar];

    if (apiKey) {
      adapters[provider] = PROVIDER_ADAPTER_FACTORIES[provider](apiKey);
      hasAnyAdapter = true;
    }
  }

  if (!hasAnyAdapter) {
    throw new Error('No API keys found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
  }

  return new Client({ providers: adapters });
}

export function describeForEachProvider(
  name: string,
  fn: (provider: TestProvider) => void,
): void {
  describe.each(PROVIDERS)(name, (provider: TestProvider) => {
    fn(provider);
  });
}

// Test fixtures
export const TEST_FIXTURES = {
  simplePrompt: 'Say hello in exactly one sentence.',

  toolDefinition: {
    name: 'get_weather',
    description: 'Get the current weather for a location',
    parameters: {
      type: 'object' as const,
      properties: {
        location: {
          type: 'string' as const,
          description: 'The location to get weather for (e.g., "New York")',
        },
      },
      required: ['location'],
    },
  },

  structuredSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string' as const,
        description: 'The person\'s name',
      },
      age: {
        type: 'number' as const,
        description: 'The person\'s age',
      },
    },
    required: ['name', 'age'],
  },

  // Minimal 1x1 transparent PNG in base64
  base64TestImage:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
};
