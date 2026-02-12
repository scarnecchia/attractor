import { expect, describe, test } from 'vitest';
import type { Tool } from '../../src/types/index.js';
import { AuthenticationError as AuthErrorType } from '../../src/types/index.js';
import { generate } from '../../src/api/generate.js';
import { generateObject } from '../../src/api/generate-object.js';
import { stream } from '../../src/api/stream.js';
import { PROVIDERS, hasApiKey, TEST_FIXTURES, DEFAULT_MODEL } from './helpers.js';
import type { TestProvider } from './helpers.js';

// Get the first provider with a valid API key
function getFirstAvailableProvider(): TestProvider | null {
  for (const provider of PROVIDERS) {
    if (hasApiKey(provider)) {
      return provider;
    }
  }
  return null;
}

describe('End-to-End Smoke Test', () => {
  const provider = getFirstAvailableProvider();
  const model = provider ? DEFAULT_MODEL[provider] : null;
  const canRun = provider && model;

  // Scenario 1: Basic generation
  test('Scenario 1: Basic generation across available providers', { skip: !canRun }, async () => {
    expect(canRun).toBe(true);

    const result = await generate({
      model: model!,
      provider: provider!,
      prompt: 'What is 2+2?',
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.toLowerCase()).toContain('4');
  });

  // Scenario 2: Streaming verification
  test('Scenario 2: Streaming collects TEXT_DELTA events correctly', { skip: !canRun }, async () => {
    const events: any[] = [];
    const textParts: string[] = [];

    const streamResult = stream({
      model: model!,
      provider: provider!,
      prompt: 'Count from 1 to 5',
      maxTokens: 100,
    });

    for await (const event of streamResult.stream) {
      events.push(event);
      if (event.type === 'TEXT_DELTA') {
        textParts.push(event.delta);
      }
    }

    const fullText = textParts.join('');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('STREAM_START');
    expect(textParts.length).toBeGreaterThan(0);
    expect(fullText).toBeTruthy();
    // Verify it contains at least some numbers
    expect(/[1-5]/.test(fullText)).toBe(true);
  });

  // Scenario 3: Image input
  test('Scenario 3: Image input returns description', { skip: !canRun }, async () => {
    const result = await generate({
      model: model!,
      provider: provider!,
      messages: [
        {
          role: 'user',
          content: [
            { kind: 'TEXT', text: 'Describe this image' },
            { kind: 'IMAGE', data: TEST_FIXTURES.base64TestImage, url: null, mediaType: 'image/png' },
          ],
        },
      ],
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  // Scenario 4: Tool calling with parallel execution
  test('Scenario 4: Tool calling with parallel execution', { skip: !canRun }, async () => {
    const tools: Array<Tool> = [
      {
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
        execute: async (args: Record<string, unknown>) => {
          const sum = (args.a as number) + (args.b as number);
          return String(sum);
        },
      },
      {
        name: 'multiply',
        description: 'Multiply two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
        execute: async (args: Record<string, unknown>) => {
          const product = (args.a as number) * (args.b as number);
          return String(product);
        },
      },
    ];

    const result = await generate({
      model: model!,
      provider: provider!,
      prompt: 'What is 3+4 and 2*5?',
      tools,
      maxTokens: 150,
    });

    // Verify at least one tool was called
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    // Verify the result contains the expected values
    expect(result.text).toBeTruthy();
    expect(result.text).toMatch(/7|10/);
  });

  // Scenario 5: Structured output
  test('Scenario 5: Structured output generates valid object', { skip: !canRun }, async () => {
    const result = await generateObject({
      model: model!,
      provider: provider!,
      prompt: 'Generate a person named Alice who is 30',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The person\'s name',
          },
          age: {
            type: 'number',
            description: 'The person\'s age',
          },
        },
        required: ['name', 'age'],
      },
      maxTokens: 100,
    });

    expect(result.object).toBeTruthy();
    expect(typeof result.object).toBe('object');
    expect(result.object).toHaveProperty('name');
    expect(result.object).toHaveProperty('age');
    expect(result.object.name).toBe('Alice');
    expect(result.object.age).toBe(30);
  });

  // Scenario 6: Error handling
  test('Scenario 6: Invalid API key throws AuthenticationError', { skip: !canRun }, async () => {
    expect.assertions(1);
    try {
      await generate({
        model: model!,
        provider: provider!,
        prompt: 'Test',
        providerOptions: {
          [provider!]: {
            apiKey: 'invalid-key-xyz-123',
          },
        },
        maxTokens: 50,
      });
      expect.fail('Expected authentication error to be thrown');
    } catch (error) {
      const err = error as unknown;
      if (err instanceof AuthErrorType) {
        expect(err.statusCode).toBe(401);
      } else {
        throw error;
      }
    }
  });
});
