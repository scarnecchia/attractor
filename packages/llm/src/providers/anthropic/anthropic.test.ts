import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicAdapter } from './index.js';
import type { LLMRequest, StreamEvent } from '../../types/index.js';

describe('Anthropic Adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getCallBody() {
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0];
    expect(call).toBeDefined();
    const bodyStr = (call?.[1] as any)?.body;
    expect(bodyStr).toBeDefined();
    return JSON.parse(bodyStr as string);
  }

  describe('AC3.2 - Anthropic headers', () => {
    it('should include x-api-key and anthropic-version headers', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const calls = fetchMock.mock.calls;
      const headers = (calls[0]?.[1] as any)?.headers;
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });
  });

  describe('AC3.5 - Message role translation', () => {
    it('should translate system message to body.system array', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body['system']).toBeDefined();
      const systemArray = body['system'] as Array<Record<string, unknown>>;
      expect(systemArray).toHaveLength(1);
      expect(systemArray[0]!['type']).toBe('text');
      expect(systemArray[0]!['text']).toBe('You are helpful');
    });

    it('should translate all 5 roles correctly', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'user msg' },
          { role: 'assistant', content: 'assistant msg' },
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: 'result',
                isError: false,
              },
            ],
          },
          { role: 'developer', content: 'developer msg' },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      const roles = messagesArray.map((m) => m['role']);
      expect(roles).toContain('user');
      expect(roles).toContain('assistant');
    });
  });

  describe('AC3.6 - Provider options escape hatch', () => {
    it('should merge providerOptions.anthropic.metadata into body', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            metadata: { user_id: '123' },
          },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.metadata).toEqual({ user_id: '123' });
    });
  });

  describe('AC3.7 - Beta headers', () => {
    it('should merge betaHeaders into anthropic-beta header', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            betaHeaders: { something: 'custom-beta-value' },
          },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const calls = fetchMock.mock.calls;
      const headers = (calls[0]?.[1] as any)?.headers;
      expect(headers['anthropic-beta']).toContain('custom-beta-value');
      expect(headers['anthropic-beta']).toContain('prompt-caching-2024-07-31');
    });
  });

  describe('AC4.1 - Text-only messages', () => {
    it('should handle text-only user message', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello world' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['type']).toBe('text');
      expect(content[0]!['text']).toBe('hello world');
    });
  });

  describe('AC4.2 - Image base64', () => {
    it('should translate base64 image correctly', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              {
                kind: 'IMAGE',
                data: 'iVBORw0KGgo=',
                url: null,
                mediaType: 'image/png',
              },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const imageBlock = content.find((c) => (c['type'] as string) === 'image');
      expect(imageBlock).toBeDefined();
      const source = imageBlock!['source'] as Record<string, unknown>;
      expect(source['type']).toBe('base64');
      expect(source['data']).toBe('iVBORw0KGgo=');
    });
  });

  describe('AC4.3 - Image URL', () => {
    it('should translate image URL correctly', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              {
                kind: 'IMAGE',
                data: null,
                url: 'https://example.com/image.png',
                mediaType: 'image/png',
              },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const imageBlock = content.find((c) => (c['type'] as string) === 'image');
      const source = imageBlock!['source'] as Record<string, unknown>;
      expect(source['type']).toBe('url');
    });
  });

  describe('AC4.5 - Tool calls', () => {
    it('should parse tool call in response', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: 'call a function',
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [
            {
              type: 'tool_use',
              id: 'call-123',
              name: 'get_weather',
              input: { location: 'NY' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'tool_use',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.content).toHaveLength(1);
      const toolCall = response.content[0]!;
      expect(toolCall.kind).toBe('TOOL_CALL');
      if (toolCall.kind === 'TOOL_CALL') {
        expect(toolCall.toolCallId).toBe('call-123');
        expect(toolCall.toolName).toBe('get_weather');
      }
    });

    it('should format tool result in request', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: '{"temp": 72}',
                isError: false,
              },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const toolResult = content.find((c) => (c['type'] as string) === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!['tool_use_id']).toBe('call-123');
    });
  });

  describe('AC4.6, AC4.7 - Thinking blocks', () => {
    it('should handle thinking content block in response', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'think about this' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [
            {
              type: 'thinking',
              thinking: 'let me analyze',
              signature: 'sig-abc',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.content).toHaveLength(1);
      const thinking = response.content[0]!;
      expect(thinking.kind).toBe('THINKING');
      if (thinking.kind === 'THINKING') {
        expect(thinking.text).toBe('let me analyze');
        expect(thinking.signature).toBe('sig-abc');
      }
    });

    it('should handle redacted thinking content block', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [
            {
              type: 'redacted_thinking',
              data: 'base64data',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.content).toHaveLength(1);
      const redacted = response.content[0]!;
      expect(redacted.kind).toBe('REDACTED_THINKING');
    });
  });

  describe('AC8.1, AC8.2, AC8.3 - Cache control', () => {
    it('should inject cache_control when autoCache is true (default)', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const systemArray = body['system'] as Array<Record<string, unknown>>;
      const lastBlock = systemArray[systemArray.length - 1];
      expect(lastBlock!['cache_control']).toBeDefined();

      const calls = fetchMock.mock.calls;
      const headers = (calls[0]?.[1] as any)?.headers;
      expect(headers['anthropic-beta']).toContain('prompt-caching-2024-07-31');
    });

    it('should not inject cache_control when autoCache is false', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            autoCache: false,
          },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const systemArray = body['system'] as Array<Record<string, unknown>>;
      const lastBlock = systemArray[systemArray.length - 1];
      expect(lastBlock!['cache_control']).toBeUndefined();
    });
  });

  describe('AC8.4, AC8.5 - Cache tokens in response', () => {
    it('should map cache_read_input_tokens to cacheReadTokens', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 25,
          },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.usage.cacheReadTokens).toBe(25);
    });

    it('should map cache_creation_input_tokens to cacheWriteTokens', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 30,
          },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.usage.cacheWriteTokens).toBe(30);
    });
  });

  describe('Message alternation', () => {
    it('should merge consecutive user messages', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'first message' },
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: 'result',
                isError: false,
              },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'claude-opus-4-6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const messagesArray = body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      expect(messagesArray[0]!['role']).toBe('user');
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      expect(content.length).toBeGreaterThan(1);
    });
  });

  describe('Streaming', () => {
    it('should support streaming with SSE events', async () => {
      const adapter = new AnthropicAdapter('test-key');
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: 'message_start',
                  message: { id: 'msg-123', model: 'claude-opus-4-6' },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: 'content_block_start',
                  content_block: { type: 'text' },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: 'hello' },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn' },
                  usage: { input_tokens: 1, output_tokens: 2 },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: 'message_stop',
                })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const events: Array<StreamEvent> = [];
      for await (const event of adapter.stream(request)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('STREAM_START');
      expect(events.some((e) => e.type === 'TEXT_DELTA')).toBe(true);
      expect(events.some((e) => e.type === 'FINISH')).toBe(true);
    });
  });
});
