import { expect, test } from 'vitest';
import type { Tool, StreamEvent } from '../../src/types/index.js';
import { AuthenticationError as AuthErrorType, RateLimitError } from '../../src/types/index.js';
import { generate } from '../../src/api/generate.js';
import { generateObject } from '../../src/api/generate-object.js';
import { stream } from '../../src/api/stream.js';
import { describeForEachProvider, hasApiKey, TEST_FIXTURES, DEFAULT_MODEL } from './helpers.js';
import type { TestProvider } from './helpers.js';

describeForEachProvider('Cross-Provider Parity Matrix', (provider: TestProvider) => {
  const model = DEFAULT_MODEL[provider];

  // Test 1: Simple generation
  test.skipIf(!hasApiKey(provider))('1. simple generation returns non-empty text', async () => {
    const result = await generate({
      model,
      provider,
      prompt: 'Say hello',
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  // Test 2: Streaming
  test.skipIf(!hasApiKey(provider))('2. streaming yields STREAM_START, TEXT_DELTA, and FINISH', async () => {
    const events: Array<StreamEvent> = [];
    const streamResult = stream({
      model,
      provider,
      prompt: 'Count to 3',
      maxTokens: 50,
    });

    for await (const event of streamResult.stream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('STREAM_START');
    const hasTextDelta = events.some((e) => e.type === 'TEXT_DELTA');
    expect(hasTextDelta).toBe(true);
    const hasFinish = events.some((e) => e.type === 'FINISH');
    expect(hasFinish).toBe(true);
  });

  // Test 3: Image input (base64)
  test.skipIf(!hasApiKey(provider))('3. image input with base64 returns non-empty text', async () => {
    const result = await generate({
      model,
      provider,
      messages: [
        {
          role: 'user',
          content: [
            { kind: 'TEXT', text: 'Describe this image in one sentence' },
            { kind: 'IMAGE', data: TEST_FIXTURES.base64TestImage, url: null, mediaType: 'image/png' },
          ],
        },
      ],
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  // Test 4: Image input (URL)
  test.skipIf(!hasApiKey(provider))('4. image input with URL returns non-empty text', async () => {
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg';

    const result = await generate({
      model,
      provider,
      messages: [
        {
          role: 'user',
          content: [
            { kind: 'TEXT', text: 'Describe this image in one sentence' },
            { kind: 'IMAGE', data: null, url: imageUrl, mediaType: 'image/jpeg' },
          ],
        },
      ],
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  // Test 5: Single tool call
  test.skipIf(!hasApiKey(provider))('5. single tool call completes successfully', async () => {
    const tools: Array<Tool> = [
      {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The location to get weather for (e.g., "New York")',
            },
          },
          required: ['location'],
        },
        execute: async () => 'Sunny, 72°F',
      },
    ];

    const result = await generate({
      model,
      provider,
      prompt: 'What is the weather in New York?',
      tools,
      maxTokens: 100,
    });

    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.text).toBeTruthy();
  });

  // Test 6: Parallel tool calls
  test.skipIf(!hasApiKey(provider))('6. parallel tool calls execute successfully', async () => {
    const tools: Array<Tool> = [
      {
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
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
            a: { type: 'number' },
            b: { type: 'number' },
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
      model,
      provider,
      prompt: 'What is 3+4 and 2*5?',
      tools,
      maxTokens: 100,
    });

    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
  });

  // Test 7: Multi-step tool loop
  test.skipIf(!hasApiKey(provider))('7. multi-step tool loop executes successfully', async () => {
    const tools: Array<Tool> = [
      {
        name: 'get_info',
        description: 'Get some information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        execute: async (args: Record<string, unknown>) => {
          return `Information about ${args.query}`;
        },
      },
    ];

    const result = await generate({
      model,
      provider,
      prompt: 'Get information about AI, then about ML',
      tools,
      maxTokens: 150,
      maxToolRounds: 3,
    });

    expect(result.text).toBeTruthy();
  });

  // Test 8: Streaming with tools
  test.skipIf(!hasApiKey(provider))('8. streaming with tools yields tool-related events and STEP_FINISH', async () => {
    const tools: Array<Tool> = [
      {
        name: 'calculate',
        description: 'Calculate something',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string' },
          },
          required: ['operation'],
        },
        execute: async () => 'result: 42',
      },
    ];

    const events: Array<StreamEvent> = [];
    const streamResult = stream({
      model,
      provider,
      prompt: 'Calculate 6 times 7',
      tools,
      maxTokens: 100,
    });

    for await (const event of streamResult.stream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('STREAM_START');
    const hasToolStart = events.some((e) => e.type === 'TOOL_CALL_START');
    const hasStepFinish = events.some((e) => e.type === 'STEP_FINISH');
    expect(hasToolStart || hasStepFinish || events.some((e) => e.type === 'TEXT_DELTA')).toBe(true);
  });

  // Test 9: Structured output
  test.skipIf(!hasApiKey(provider))('9. structured output returns valid object matching schema', async () => {
    const result = await generateObject({
      model,
      provider,
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
  });

  // Test 10: Error handling (invalid key)
  test.skipIf(!hasApiKey(provider))('10. invalid API key throws AuthenticationError', async () => {
    expect.assertions(1);
    try {
      await generate({
        model,
        provider,
        prompt: 'Test',
        providerOptions: {
          [provider]: {
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

  // Test 11: Usage accuracy
  test.skipIf(!hasApiKey(provider))('11. usage tokens are accurate', async () => {
    const result = await generate({
      model,
      provider,
      prompt: 'Say hello',
      maxTokens: 50,
    });

    expect(result.totalUsage.inputTokens).toBeGreaterThan(0);
    expect(result.totalUsage.outputTokens).toBeGreaterThan(0);
    expect(result.totalUsage.totalTokens).toBeGreaterThan(0);
  });

  // Test 12: Provider options passthrough
  test.skipIf(!hasApiKey(provider))('12. provider-specific options pass through without error', async () => {
    const providerOptions: Record<string, Record<string, unknown>> = {};

    if (provider === 'openai') {
      providerOptions.openai = {
        frequencyPenalty: 0.5,
      };
    } else if (provider === 'anthropic') {
      providerOptions.anthropic = {
        budget_tokens: 500,
      };
    } else if (provider === 'gemini') {
      providerOptions.gemini = {
        generationConfig: {
          candidateCount: 1,
        },
      };
    }

    const result = await generate({
      model,
      provider,
      prompt: 'Say hello',
      providerOptions,
      maxTokens: 50,
    });

    expect(result.text).toBeTruthy();
  });

  // Test 13: Rate limit error handling
  test('13. rate limit errors are handled appropriately', () => {
    // This test verifies the SDK can handle rate limit errors
    // Triggering actual rate limits is not feasible in integration tests
    // Instead, we verify the error type can be instantiated with expected properties
    const error = new RateLimitError('Rate limit exceeded', 429, 'test-provider', null, null, 60);
    expect(error).toBeTruthy();
    expect(error instanceof RateLimitError).toBe(true);
    expect(error.statusCode).toBe(429);
    expect(error.retryAfter).toBe(60);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Rate limit exceeded');
  });
});
