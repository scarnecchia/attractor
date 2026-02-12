import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './index.js';
import type { LLMRequest, ToolCallData, StreamEvent } from '../../types/index.js';

describe('OpenAI Adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  

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

  describe('AC3.1 - Responses API endpoint', () => {
    it('should use /v1/responses endpoint, not /v1/chat/completions', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const calls = fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const url = calls[0]?.[0] as string;
      expect(url).toContain('/v1/responses');
      expect(url).not.toContain('/v1/chat/completions');
    });
  });

  describe('AC3.5 - Message role translation', () => {
    it('should translate system message to instructions', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.instructions).toBe('You are helpful');
    });

    it('should translate user messages correctly', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.input[0].type).toBe('message');
      expect(body.input[0].role).toBe('user');
    });

    it('should translate assistant messages correctly', async () => {
      const adapter = new OpenAIAdapter('test-key');
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
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const assistantMsg = body.input.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.type).toBe('message');
    });

    it('should translate tool result messages correctly', async () => {
      const adapter = new OpenAIAdapter('test-key');
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
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const toolOutput = body.input.find((m: any) => m.type === 'function_call_output');
      expect(toolOutput).toBeDefined();
      expect(toolOutput.call_id).toBe('call-123');
      expect(toolOutput.output).toBe('result');
    });
  });

  describe('AC3.6 - Provider options escape hatch', () => {
    it('should include providerOptions.openai in request body', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          openai: {
            reasoning_effort: 'high',
            custom_field: 'value',
          },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.reasoning_effort).toBe('high');
      expect(body.custom_field).toBe('value');
    });
  });

  describe('AC4.1 - Text-only messages', () => {
    it('should handle text-only user message', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const userMsg = body.input[0];
      expect(userMsg.type).toBe('message');
      expect(userMsg.content).toBe('hello');
    });
  });

  describe('AC4.2 - Image base64 input', () => {
    it('should include image with base64 data as input_image', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { kind: 'TEXT', text: 'what is this?' },
              { kind: 'IMAGE', data: 'abc123', url: null, mediaType: 'image/png' },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const userMsg = body.input[0];
      const imageContent = userMsg.content.find((c: any) => c.type === 'input_image');
      expect(imageContent).toBeDefined();
      expect(imageContent.image_url).toBe('data:image/png;base64,abc123');
    });
  });

  describe('AC4.3 - Image URL input', () => {
    it('should include image with URL as input_image', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { kind: 'TEXT', text: 'what is this?' },
              { kind: 'IMAGE', data: null, url: 'https://example.com/image.png', mediaType: 'image/png' },
            ],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const userMsg = body.input[0];
      const imageContent = userMsg.content.find((c: any) => c.type === 'input_image');
      expect(imageContent).toBeDefined();
      expect(imageContent.image_url).toBe('https://example.com/image.png');
    });
  });

  describe('AC4.5 - Tool call round-trip', () => {
    it('should parse tool call from response', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'call a tool' }],
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {},
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [
            {
              type: 'function_call',
              call_id: 'call-456',
              name: 'test_tool',
              arguments: JSON.stringify({ param: 'value' }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'tool_calls',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      const toolCall = response.content.find((c) => c.kind === 'TOOL_CALL') as ToolCallData | undefined;
      expect(toolCall).toBeDefined();
      expect(toolCall?.toolCallId).toBe('call-456');
      expect(toolCall?.toolName).toBe('test_tool');
      expect(toolCall?.args).toEqual({ param: 'value' });
    });

    it('should handle tool result in subsequent request', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'call a tool' },
          {
            role: 'assistant',
            content: [
              { kind: 'TOOL_CALL', toolCallId: 'call-456', toolName: 'test_tool', args: { param: 'value' } },
            ],
          },
          {
            role: 'tool',
            content: [{ kind: 'TOOL_RESULT', toolCallId: 'call-456', content: 'tool result', isError: false }],
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [{ type: 'message', content: 'The result is correct' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      const toolOutput = body.input.find((m: any) => m.type === 'function_call_output');
      expect(toolOutput.call_id).toBe('call-456');
      expect(toolOutput.output).toBe('tool result');
    });
  });

  describe('AC9.1 - Reasoning tokens', () => {
    it('should map reasoning_tokens from response usage', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5, reasoning_tokens: 100 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.usage.reasoningTokens).toBe(100);
    });
  });

  describe('AC9.2 - reasoning_effort parameter', () => {
    it('should pass reasoning_effort through to request body', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          openai: { reasoning_effort: 'high' },
        },
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      await adapter.complete(request);

      const body = getCallBody();
      expect(body.reasoning_effort).toBe('high');
    });
  });

  describe('AC8.4 - Cache read tokens', () => {
    it('should map cached_tokens from usage to cacheReadTokens', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'resp-123',
          model: 'gpt-4o',
          output: [],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            prompt_tokens_details: { cached_tokens: 50 },
          },
          stop_reason: 'stop',
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const response = await adapter.complete(request);

      expect(response.usage.cacheReadTokens).toBe(50);
    });
  });

  describe('Stream handling', () => {
    it('should stream text deltas', async () => {
      const adapter = new OpenAIAdapter('test-key');
      const request: LLMRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const mockResponse = {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp-1', model: 'gpt-4o' } })}\n\n`),
            );
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hello ' })}\n\n`),
            );
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, status: 'success' } })}\n\n`),
            );
            controller.close();
          },
        }),
      };
      fetchMock.mockResolvedValueOnce(mockResponse);

      const events: StreamEvent[] = [];
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
