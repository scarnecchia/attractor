import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleAdapter } from './index.js';
import type { LLMRequest, StreamEvent } from '../../types/index.js';
import type { SSEEvent } from '../../utils/sse.js';

describe('OpenAI-Compatible Adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

  describe('AC3.4 - Chat Completions endpoint', () => {
    it('should use /v1/chat/completions endpoint', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [
            {
              message: { role: 'assistant', content: 'hi' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const calls = fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const url = calls[0]?.[0] as string;
      expect(url).toContain('/v1/chat/completions');
      expect(url).toContain('https://api.example.com');
    });

    it('should use custom baseUrl, not OpenAI default', async () => {
      const customUrl = 'https://groq.example.com';
      const adapter = new OpenAICompatibleAdapter('test-key', customUrl);
      const request: LLMRequest = {
        model: 'llama-2',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg-123',
          model: 'llama-2',
          choices: [
            {
              message: { role: 'assistant', content: 'hi' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toContain('groq.example.com');
      expect(url).not.toContain('openai.com');
    });
  });

  describe('AC3.5 - Message role translation', () => {
    it('should translate system message to system role', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('You are helpful');
    });

    it('should translate user messages correctly', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const userMsg = body.messages.find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg.content).toBe('hello');
    });

    it('should translate assistant messages correctly', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBe('hi there');
    });

    it('should translate tool messages correctly', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'hello' },
          {
            role: 'tool',
            content: [{ kind: 'TOOL_RESULT', toolCallId: 'call-123', content: 'result', isError: false }],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const toolMsg = body.messages.find((m: any) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe('call-123');
      expect(toolMsg.content).toBe('result');
    });
  });

  describe('AC3.6 - Provider options escape hatch', () => {
    it('should merge openaiCompatible options into request body', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          openaiCompatible: {
            frequency_penalty: 0.5,
            presence_penalty: 0.2,
          },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.frequency_penalty).toBe(0.5);
      expect(body.presence_penalty).toBe(0.2);
    });
  });

  describe('AC4.1 - Text-only messages', () => {
    it('should translate text-only user message correctly', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello world' }],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const userMsg = body.messages.find((m: any) => m.role === 'user');
      expect(userMsg.content).toBe('hello world');
    });
  });

  describe('AC4.5 - Tool calls and results', () => {
    it('should parse tool call arguments from JSON string', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          model: 'gpt-4o',
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-xyz',
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"NYC","units":"C"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'what is the weather?' }],
      };

      const response = await adapter.complete(request);

      expect(response.content).toHaveLength(1);
      const toolCall = response.content[0];
      expect(toolCall?.kind).toBe('TOOL_CALL');
      if (toolCall && toolCall.kind === 'TOOL_CALL') {
        expect(toolCall.toolCallId).toBe('call-xyz');
        expect(toolCall.toolName).toBe('get_weather');
        expect(toolCall.args['location']).toBe('NYC');
        expect(toolCall.args['units']).toBe('C');
      }
    });

    it('should format tool result in request as tool role message', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-xyz',
                content: 'Sunny, 25C',
                isError: false,
              },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-456',
          model: 'gpt-4o',
          choices: [{ message: { content: 'The weather is sunny' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const toolMsg = body.messages.find((m: any) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe('call-xyz');
      expect(toolMsg.content).toBe('Sunny, 25C');
    });
  });

  describe('Custom adapter name', () => {
    it('should support custom name option', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://groq.api.com', { name: 'groq' });
      expect(adapter.name).toBe('groq');
    });

    it('should default to openai-compatible if no name provided', async () => {
      const adapter = new OpenAICompatibleAdapter('test-key', 'https://api.example.com');
      expect(adapter.name).toBe('openai-compatible');
    });
  });

  describe('AC4.1 - Stream test', () => {
    it('should handle [DONE] marker and stop iteration', async () => {
      const { translateStream } = await import('./stream.js');

      const sseEvents: Array<SSEEvent> = [
        {
          event: '',
          data: '{"id":"chatcmpl-123","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
        },
        {
          event: '',
          data: '{"id":"chatcmpl-123","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
        },
        {
          event: '',
          data: '{"id":"chatcmpl-123","choices":[{"delta":{},"finish_reason":"stop"}]}',
        },
        {
          event: '',
          data: '[DONE]',
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of sseEvents) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable)) {
        results.push(event);
      }

      // Should have STREAM_START, TEXT_DELTA, FINISH
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.type).toBe('STREAM_START');
      expect(results.some((e) => e.type === 'TEXT_DELTA')).toBe(true);
      expect(results[results.length - 1]?.type).toBe('FINISH');
    });
  });
});
