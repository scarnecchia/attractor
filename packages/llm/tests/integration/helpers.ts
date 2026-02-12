import { describe } from 'vitest';

export const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
export type TestProvider = typeof PROVIDERS[number];

const PROVIDER_ENV_VARS: Record<TestProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export function hasApiKey(provider: TestProvider): boolean {
  const envVar = PROVIDER_ENV_VARS[provider];
  const apiKey = process.env[envVar];
  return !!apiKey;
}

export function describeForEachProvider(
  name: string,
  fn: (provider: Readonly<TestProvider>) => void,
): void {
  describe.each(PROVIDERS)(name, (provider: TestProvider) => {
    fn(provider);
  });
}

export const DEFAULT_MODEL: Readonly<Record<TestProvider, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-2.0-flash',
};

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
} as const;
