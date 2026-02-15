import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAdapter } from './index.js';
import { translateRequest } from './request.js';
import { translateResponse } from './response.js';
import { translateStream } from './stream.js';
import type { LLMRequest, StreamEvent } from '../../types/index.js';
import type { SSEEvent } from '../../utils/sse.js';

describe('Gemini Adapter', () => {
  describe('Request translation (AC3.3, AC3.5, AC3.6, AC4.1, AC4.2, AC4.3)', () => {
    it('should generate correct blocking URL with API key (AC3.3)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [],
      };

      const { url } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      expect(url).toContain('gemini-2.0-flash:generateContent');
      expect(url).toContain('key=test-key');
      expect(url).not.toContain('alt=sse');
    });

    it('should generate correct streaming URL with alt=sse (AC3.3)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [],
      };

      const { url } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', true);

      expect(url).toContain('gemini-2.0-flash:streamGenerateContent');
      expect(url).toContain('key=test-key');
      expect(url).toContain('alt=sse');
    });

    it('should translate system message to systemInstruction', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        system: 'You are helpful',
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      expect(body['systemInstruction']).toEqual({
        role: 'user',
        parts: [{ text: 'You are helpful' }],
      });
    });

    it('should translate user message with text role to model-user role (AC3.5)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello' }],
          },
        ],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const contents = body['contents'] as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(1);
      expect(contents[0]?.['role']).toBe('user');
      expect(contents[0]?.['parts']).toEqual([{ text: 'hello' }]);
    });

    it('should translate assistant message to model role (AC3.5)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'assistant',
            content: [{ kind: 'TEXT', text: 'response' }],
          },
        ],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const contents = body['contents'] as Array<Record<string, unknown>>;
      expect(contents[0]?.['role']).toBe('model');
    });

    it('should translate tool result to user message with functionResponse (AC3.5)', () => {
      // Tool results come from the SDK after tool calls from Gemini responses
      // The tool call ID is mapped from the response, then used for the tool result
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'what is the weather?' }],
          },
          {
            role: 'assistant',
            content: [
              {
                kind: 'TOOL_CALL',
                toolCallId: 'call-123',
                toolName: 'get_weather',
                args: { location: 'NY' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: 'sunny',
                isError: false,
              },
            ],
          },
        ],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const contents = body['contents'] as Array<Record<string, unknown>>;
      // Should have user, then tool result (assistant tool call is skipped)
      expect(contents).toHaveLength(2);
      // First is user message
      expect(contents[0]?.['role']).toBe('user');
      // Second is tool result
      expect(contents[1]?.['role']).toBe('user');
      const toolResultParts = contents[1]?.['parts'] as Array<Record<string, unknown>>;
      expect(toolResultParts[0]?.['functionResponse']).toEqual({
        name: 'get_weather',
        response: {
          result: 'sunny',
        },
      });
    });

    it('should translate base64 image to inlineData (AC4.2)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [
              { kind: 'TEXT', text: 'describe' },
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

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const contents = body['contents'] as Array<Record<string, unknown>>;
      const parts = contents[0]?.['parts'] as Array<Record<string, unknown>>;
      expect(parts[1]?.['inlineData']).toEqual({
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      });
    });

    it('should translate image URL to fileData (AC4.3)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                kind: 'IMAGE',
                data: null,
                url: 'https://example.com/img.jpg',
                mediaType: 'image/jpeg',
              },
            ],
          },
        ],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const contents = body['contents'] as Array<Record<string, unknown>>;
      const parts = contents[0]?.['parts'] as Array<Record<string, unknown>>;
      expect(parts[0]?.['fileData']).toEqual({
        mimeType: 'image/jpeg',
        fileUri: 'https://example.com/img.jpg',
      });
    });

    it('should translate tools array (AC3.5)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        ],
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const tools = body['tools'] as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      const decls = tools[0]?.['function_declarations'] as Array<Record<string, unknown>>;
      expect(decls[0]?.['name']).toBe('get_weather');
    });

    it('should translate toolChoice auto to AUTO mode', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        toolChoice: { mode: 'auto' },
        tools: [],
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const toolConfig = body['toolConfig'] as Record<string, unknown>;
      const fcc = toolConfig['functionCallingConfig'] as Record<string, unknown>;
      expect(fcc['mode']).toBe('AUTO');
    });

    it('should translate toolChoice none to NONE mode', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        toolChoice: { mode: 'none' },
        tools: [],
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const toolConfig = body['toolConfig'] as Record<string, unknown>;
      const fcc = toolConfig['functionCallingConfig'] as Record<string, unknown>;
      expect(fcc['mode']).toBe('NONE');
    });

    it('should translate toolChoice required to ANY mode', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        toolChoice: { mode: 'required' },
        tools: [],
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const toolConfig = body['toolConfig'] as Record<string, unknown>;
      const fcc = toolConfig['functionCallingConfig'] as Record<string, unknown>;
      expect(fcc['mode']).toBe('ANY');
    });

    it('should translate named toolChoice to ANY mode with allowedFunctionNames (AC3.5)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        toolChoice: { mode: 'named', toolName: 'get_weather' },
        tools: [],
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const toolConfig = body['toolConfig'] as Record<string, unknown>;
      const fcc = toolConfig['functionCallingConfig'] as Record<string, unknown>;
      expect(fcc['mode']).toBe('ANY');
      expect(fcc['allowedFunctionNames']).toEqual(['get_weather']);
    });

    it('should include generation config with maxOutputTokens', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        maxTokens: 1000,
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const genConfig = body['generationConfig'] as Record<string, unknown>;
      expect(genConfig['maxOutputTokens']).toBe(1000);
    });

    it('should include generation config with temperature and topP', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        temperature: 0.7,
        topP: 0.9,
        messages: [],
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      const genConfig = body['generationConfig'] as Record<string, unknown>;
      expect(genConfig['temperature']).toBe(0.7);
      expect(genConfig['topP']).toBe(0.9);
    });

    it('should spread providerOptions.gemini into body (AC3.6)', () => {
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [],
        providerOptions: {
          gemini: {
            candidateCount: 1,
          },
        },
      };

      const { body } = translateRequest(request, 'test-key', 'https://generativelanguage.googleapis.com', false);

      expect(body['candidateCount']).toBe(1);
    });
  });

  describe('Response translation (AC3.3, AC4.2, AC8.4, AC9.5)', () => {
    it('should map id and model from raw response', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.id).toBeTruthy();
      expect(result.model).toBe('gemini-2.0-flash');
    });

    it('should translate text content', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: {
              parts: [{ text: 'hello world' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.content).toHaveLength(1);
      const text = result.content[0] as Record<string, unknown>;
      expect(text['kind']).toBe('TEXT');
      expect(text['text']).toBe('hello world');
    });

    it('should translate functionCall to ToolCallData with synthetic UUID', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'NY' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const toolCallIdMap = new Map<string, string>();
      const result = translateResponse(raw as Record<string, unknown>, toolCallIdMap);

      expect(result.content).toHaveLength(1);
      const toolCall = result.content[0] as Record<string, unknown>;
      expect(toolCall['kind']).toBe('TOOL_CALL');
      expect(toolCall['toolCallId']).toBeTruthy();
      expect(toolCall['toolName']).toBe('get_weather');
      expect(toolCall['args']).toEqual({ location: 'NY' });

      // Verify mapping was stored
      expect(toolCallIdMap.get(toolCall['toolCallId'] as string)).toBe('get_weather');
    });

    it('should map usage metadata to response usage', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
          thoughtsTokenCount: 2,
          cachedContentTokenCount: 3,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
      expect(result.usage.reasoningTokens).toBe(2);
      expect(result.usage.cacheReadTokens).toBe(3);
    });

    it('should map STOP finish reason to stop', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.finishReason).toBe('stop');
    });

    it('should map MAX_TOKENS finish reason to length', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.finishReason).toBe('length');
    });

    it('should map SAFETY finish reason to content_filter', () => {
      const raw = {
        model: 'gemini-2.0-flash',
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'SAFETY',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = translateResponse(raw as Record<string, unknown>, new Map());

      expect(result.finishReason).toBe('content_filter');
    });
  });

  describe('Stream translation', () => {
    it('should emit STREAM_START on first event', async () => {
      const events: SSEEvent[] = [
        {
          event: '',
          data: JSON.stringify({
            model: 'gemini-2.0-flash',
            candidates: [
              {
                content: { parts: [{ text: 'hello' }] },
              },
            ],
          }),
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable, new Map())) {
        results.push(event);
      }

      expect(results[0]?.['type']).toBe('STREAM_START');
      expect((results[0] as Record<string, unknown>)?.['model']).toBe('gemini-2.0-flash');
    });

    it('should emit TEXT_DELTA for text content', async () => {
      const events: SSEEvent[] = [
        {
          event: '',
          data: JSON.stringify({
            model: 'gemini-2.0-flash',
            candidates: [
              {
                content: { parts: [{ text: 'hello' }] },
              },
            ],
          }),
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable, new Map())) {
        results.push(event);
      }

      expect(results.some((e) => e['type'] === 'TEXT_DELTA' && e['text'] === 'hello')).toBe(true);
    });

    it('should emit TOOL_CALL_START and TOOL_CALL_END for function calls', async () => {
      const events: SSEEvent[] = [
        {
          event: '',
          data: JSON.stringify({
            model: 'gemini-2.0-flash',
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'get_weather',
                        args: { location: 'NY' },
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable, new Map())) {
        results.push(event);
      }

      const hasStart = results.some((e) => e['type'] === 'TOOL_CALL_START' && e['toolName'] === 'get_weather');
      const hasEnd = results.some((e) => e['type'] === 'TOOL_CALL_END');
      expect(hasStart).toBe(true);
      expect(hasEnd).toBe(true);
    });

    it('should emit FINISH with usage on final event', async () => {
      const events: SSEEvent[] = [
        {
          event: '',
          data: JSON.stringify({
            model: 'gemini-2.0-flash',
            candidates: [
              {
                content: { parts: [{ text: 'hello' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          }),
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable, new Map())) {
        results.push(event);
      }

      const finishEvent = results.find((e) => e['type'] === 'FINISH');
      expect(finishEvent).toBeTruthy();
      expect(finishEvent?.['finishReason']).toBe('stop');
      expect((finishEvent as Record<string, unknown>)?.['usage']).toBeTruthy();
      expect(((finishEvent as Record<string, unknown>)?.['usage'] as Record<string, unknown>)?.['inputTokens']).toBe(10);
    });

    it('should ignore [DONE] sentinel', async () => {
      const events: SSEEvent[] = [
        {
          event: '',
          data: JSON.stringify({
            model: 'gemini-2.0-flash',
            candidates: [
              {
                content: { parts: [{ text: 'hello' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          }),
        },
        {
          event: '',
          data: '[DONE]',
        },
      ];

      const asyncIterable = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(asyncIterable, new Map())) {
        results.push(event);
      }

      // Should have STREAM_START, TEXT_DELTA, FINISH, no error from [DONE]
      expect(results.some((e) => e['type'] === 'FINISH')).toBe(true);
    });
  });

  describe('GeminiAdapter class', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should have name gemini', () => {
      const adapter = new GeminiAdapter('test-key');
      expect(adapter.name).toBe('gemini');
    });

    it('should call complete with correct flow', async () => {
      const adapter = new GeminiAdapter('test-key');

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-2.0-flash',
          candidates: [
            {
              content: { parts: [{ text: 'response' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
        text: async () => '',
        headers: new Headers(),
      } as Response);

      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello' }],
          },
        ],
      };

      const response = await adapter.complete(request);

      expect(response.id).toBeTruthy();
      expect(response.model).toBe('gemini-2.0-flash');
      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.['kind']).toBe('TEXT');
    });
  });

  describe('reasoningEffort', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function getRequestBody(): Record<string, unknown> {
      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const call = calls[0];
      expect(call).toBeDefined();
      const bodyStr = (call?.[1] as any)?.body;
      expect(bodyStr).toBeDefined();
      return JSON.parse(bodyStr as string);
    }

    it('maps low/medium/high to provider-specific format', async () => {
      const budgetMap = {
        low: 1024,
        medium: 4096,
        high: 16384,
      };

      for (const [effort, budget] of Object.entries(budgetMap)) {
        const adapter = new GeminiAdapter('test-key');
        const request: LLMRequest = {
          model: 'gemini-2.0-flash',
          messages: [
            {
              role: 'user',
              content: [{ kind: 'TEXT', text: 'hello' }],
            },
          ],
          reasoningEffort: effort as 'low' | 'medium' | 'high',
        };

        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'test response' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
            },
          }),
          text: async () => '',
          headers: new Headers(),
        } as Response);

        await adapter.complete(request);

        const body = getRequestBody();
        expect(body['generationConfig']).toBeDefined();
        const generationConfig = body['generationConfig'] as Record<string, unknown>;
        expect(generationConfig['thinkingConfig']).toBeDefined();
        const thinkingConfig = generationConfig['thinkingConfig'] as Record<string, unknown>;
        expect(thinkingConfig['thinkingBudget']).toBe(budget);

        vi.mocked(globalThis.fetch).mockClear();
      }
    });

    it('omits reasoning params when reasoningEffort is undefined', async () => {
      const adapter = new GeminiAdapter('test-key');
      const request: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello' }],
          },
        ],
      };

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'test response' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
          },
        }),
        text: async () => '',
        headers: new Headers(),
      } as Response);

      await adapter.complete(request);

      const body = getRequestBody();
      if (body['generationConfig']) {
        const generationConfig = body['generationConfig'] as Record<string, unknown>;
        expect(generationConfig['thinkingConfig']).toBeUndefined();
      }
    });

    it('changing reasoningEffort between calls produces different bodies', async () => {
      const adapter = new GeminiAdapter('test-key');

      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'test response' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
          },
        }),
        text: async () => '',
        headers: new Headers(),
      } as Response;

      const request1: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello' }],
          },
        ],
        reasoningEffort: 'low',
      };

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);
      await adapter.complete(request1);
      const body1 = getRequestBody();

      vi.mocked(globalThis.fetch).mockClear();
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);
      const request2: LLMRequest = {
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'TEXT', text: 'hello' }],
          },
        ],
        reasoningEffort: 'high',
      };
      await adapter.complete(request2);
      const body2 = getRequestBody();

      expect(body1['generationConfig']).toBeDefined();
      expect(body2['generationConfig']).toBeDefined();
      const config1 = (body1['generationConfig'] as Record<string, unknown>)['thinkingConfig'] as Record<string, unknown>;
      const config2 = (body2['generationConfig'] as Record<string, unknown>)['thinkingConfig'] as Record<string, unknown>;
      expect(config1['thinkingBudget']).toBe(1024);
      expect(config2['thinkingBudget']).toBe(16384);
    });
  });
});
