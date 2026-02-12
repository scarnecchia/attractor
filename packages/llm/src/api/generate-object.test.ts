import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMResponse, LLMRequest, ContentPart, Message } from '../index.js';
import { generateObject, type GenerateObjectOptions, type GenerateObjectResult } from './generate-object.js';
import { NoObjectGeneratedError, emptyUsage } from '../types/index.js';
import { setDefaultClient, resetDefaultClient } from '../client/default-client.js';
import { Client } from '../client/client.js';
import type { ProviderAdapter } from '../types/index.js';

interface MockClientResult {
  client: Client;
  capturedRequests: Array<LLMRequest>;
}

function createMockClient(
  responses: Array<LLMResponse> = [],
  providerName: string = 'openai',
): MockClientResult {
  const mockResponses = responses.length > 0
    ? responses
    : [
      {
        id: 'response-1',
        model: 'test-model',
        content: [{ kind: 'TEXT', text: '{"name": "Alice", "age": 30}' }],
        finishReason: 'stop' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      },
    ];

  let callCount = 0;
  const capturedRequests: Array<LLMRequest> = [];

  const mockAdapter: ProviderAdapter = {
    name: providerName,
    complete: vi.fn(async (request: LLMRequest): Promise<LLMResponse> => {
      capturedRequests.push(request);
      const response = mockResponses[Math.min(callCount, mockResponses.length - 1)]! as LLMResponse;
      callCount += 1;
      return response;
    }),
    stream: vi.fn(),
    close: vi.fn(),
  };

  const client = new Client({
    providers: {
      [providerName]: mockAdapter,
    },
    defaultProvider: providerName,
  });

  return { client, capturedRequests };
}

describe('generateObject()', () => {
  beforeEach(() => {
    resetDefaultClient();
  });

  afterEach(() => {
    resetDefaultClient();
  });

  describe('AC11.1: OpenAI provider with json_schema', () => {
    it('should use native json_schema response format for OpenAI', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const { client: mockClient, capturedRequests } = createMockClient([], 'openai');
      const result = await generateObject({
        model: 'gpt-4',
        prompt: 'Extract user info',
        schema,
        schemaName: 'User',
        client: mockClient,
      });

      expect(result.object).toEqual({ name: 'Alice', age: 30 });

      // Verify request had responseFormat with json_schema
      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0]!;
      expect(request.responseFormat).toBeDefined();
      expect(request.responseFormat).toMatchObject({
        type: 'json_schema',
        json_schema: expect.objectContaining({
          name: 'User',
        }),
      });
    });
  });

  describe('AC11.2: Gemini provider with responseSchema', () => {
    it('should set generationConfig.responseSchema for Gemini', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const { client: mockClient, capturedRequests } = createMockClient([], 'gemini');
      const result = await generateObject({
        model: 'gemini-2.0-flash',
        prompt: 'Extract user info',
        schema,
        client: mockClient,
      });

      expect(result.object).toEqual({ name: 'Alice', age: 30 });

      // Verify request had providerOptions for Gemini
      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0]!;
      expect(request.providerOptions?.['gemini']).toBeDefined();
      const geminiConfig = request.providerOptions?.['gemini'] as Record<string, unknown>;
      expect((geminiConfig?.['generationConfig'] as Record<string, unknown>)?.['responseSchema']).toEqual(schema);
      expect((geminiConfig?.['generationConfig'] as Record<string, unknown>)?.['responseMimeType']).toBe('application/json');
    });
  });

  describe('AC11.3: Anthropic provider with tool-based extraction', () => {
    it('should create __extract tool and set toolChoice for Anthropic', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      // For Anthropic, the response contains tool calls
      const anthropicResponse: LLMResponse = {
        id: 'response-1',
        model: 'claude-3-sonnet-20240229',
        content: [
          {
            kind: 'TOOL_CALL',
            toolCallId: 'tool-call-1',
            toolName: '__extract',
            args: { name: 'Alice', age: 30 },
          },
        ],
        finishReason: 'tool_calls' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      };

      const { client: mockClient, capturedRequests } = createMockClient([anthropicResponse], 'anthropic');
      const result = await generateObject({
        model: 'claude-3-sonnet-20240229',
        prompt: 'Extract user info',
        schema,
        client: mockClient,
      });

      expect(result.object).toEqual({ name: 'Alice', age: 30 });

      // Verify request had __extract tool
      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0]!;
      expect(request.tools).toBeDefined();
      const extractTool = request.tools?.find((t) => t.name === '__extract');
      expect(extractTool).toBeDefined();
      expect(extractTool?.parameters).toEqual(schema);
      expect(request.toolChoice).toEqual({
        mode: 'named',
        toolName: '__extract',
      });
    });
  });

  describe('AC11.4: Valid JSON output with all schema fields', () => {
    it('should return parsed object with correct types', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string' },
        },
        required: ['name', 'age', 'email'],
      };

      const mockResponse: LLMResponse = {
        id: 'response-1',
        model: 'gpt-4',
        content: [
          {
            kind: 'TEXT',
            text: '{"name": "Bob", "age": 25, "email": "bob@example.com"}',
          },
        ],
        finishReason: 'stop' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      };

      const { client: mockClient } = createMockClient([mockResponse], 'openai');
      const result = await generateObject({
        model: 'gpt-4',
        prompt: 'Extract user',
        schema,
        client: mockClient,
      });

      expect(result.object).toEqual({
        name: 'Bob',
        age: 25,
        email: 'bob@example.com',
      });
      const obj = result.object as Record<string, unknown>;
      expect(typeof obj['age']).toBe('number');
    });
  });

  describe('AC11.5: Invalid JSON throws NoObjectGeneratedError', () => {
    it('should throw NoObjectGeneratedError on invalid JSON', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const mockResponse: LLMResponse = {
        id: 'response-1',
        model: 'gpt-4',
        content: [{ kind: 'TEXT', text: '{invalid json}' }],
        finishReason: 'stop' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      };

      const { client: mockClient } = createMockClient([mockResponse], 'openai');

      await expect(
        generateObject({
          model: 'gpt-4',
          prompt: 'Extract user',
          schema,
          client: mockClient,
        }),
      ).rejects.toThrow(NoObjectGeneratedError);
    });
  });

  describe('AC11.5: Missing required field throws NoObjectGeneratedError', () => {
    it('should throw NoObjectGeneratedError when required field is missing', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'email'],
      };

      const mockResponse: LLMResponse = {
        id: 'response-1',
        model: 'gpt-4',
        content: [{ kind: 'TEXT', text: '{"name": "Alice"}' }],
        finishReason: 'stop' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      };

      const { client: mockClient } = createMockClient([mockResponse], 'openai');

      await expect(
        generateObject({
          model: 'gpt-4',
          prompt: 'Extract user',
          schema,
          client: mockClient,
        }),
      ).rejects.toThrow(NoObjectGeneratedError);
    });
  });

  describe('OpenAI-compatible provider', () => {
    it('should use json_schema for openai-compatible provider', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const { client: mockClient, capturedRequests } = createMockClient([], 'openai-compatible');
      const result = await generateObject({
        model: 'some-compatible-model',
        prompt: 'Extract',
        schema,
        schemaName: 'Data',
        client: mockClient,
      });

      expect(result.object).toEqual({ name: 'Alice', age: 30 });

      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0]!;
      expect(request.responseFormat).toBeDefined();
      const fmt = request.responseFormat as Record<string, unknown>;
      expect(fmt?.['type']).toBe('json_schema');
    });
  });
});
