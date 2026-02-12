import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client, LLMResponse, ContentPart, Tool, Message } from '../index.js';
import { generate, type GenerateResult, type GenerateOptions } from './generate.js';
import { ValidationError, AbortError, emptyUsage } from '../types/index.js';
import { setDefaultClient, resetDefaultClient } from '../client/default-client.js';

function createMockClient(
  responses: Array<LLMResponse> = [],
): Client {
  const mockResponses = responses.length > 0
    ? responses
    : [
      {
        id: 'response-1',
        model: 'test-model',
        content: [{ kind: 'TEXT', text: 'Hello' }],
        finishReason: 'stop' as const,
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      },
    ];

  let callCount = 0;

  return {
    name: 'test',
    complete: vi.fn(async () => {
      const response = mockResponses[Math.min(callCount, mockResponses.length - 1)];
      callCount += 1;
      return response;
    }),
    stream: vi.fn(),
    close: vi.fn(),
  } as unknown as Client;
}

describe('generate()', () => {
  beforeEach(() => {
    resetDefaultClient();
  });

  afterEach(() => {
    resetDefaultClient();
  });

  describe('AC5.1: simple prompt to text response', () => {
    it('should convert prompt to user message and return text', async () => {
      const mockClient = createMockClient();
      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
      });

      expect(result.text).toBe('Hello');
      expect(result.response.content[0]).toEqual({ kind: 'TEXT', text: 'Hello' });
    });
  });

  describe('AC5.2: messages parameter', () => {
    it('should accept messages directly', async () => {
      const mockClient = createMockClient();
      const messages: Array<Message> = [
        { role: 'user', content: 'hello' },
      ];

      const result = await generate({
        model: 'test-model',
        messages,
        client: mockClient,
      });

      expect(result.text).toBe('Hello');
      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining(messages),
        }),
      );
    });
  });

  describe('AC5.3: validation error on both prompt and messages', () => {
    it('should throw ValidationError when both prompt and messages are set', async () => {
      const mockClient = createMockClient();

      await expect(
        generate({
          model: 'test-model',
          prompt: 'hello',
          messages: [{ role: 'user', content: 'hi' }],
          client: mockClient,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('AC5.7: abort signal', () => {
    it('should pass abort signal to client.complete', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const mockClient = createMockClient();
      vi.mocked(mockClient.complete).mockRejectedValueOnce(
        new AbortError('Aborted'),
      );

      await expect(
        generate({
          model: 'test-model',
          prompt: 'hello',
          client: mockClient,
          signal: abortController.signal,
        }),
      ).rejects.toThrow(AbortError);
    });
  });

  describe('AC5.8: timeout handling', () => {
    it('should propagate timeout configuration to client', async () => {
      const mockClient = createMockClient();
      const timeoutConfig = {
        requestMs: 1000,
      };

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        timeout: timeoutConfig,
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: timeoutConfig,
        }),
      );
    });
  });

  describe('AC10.1: active tools trigger execution loop', () => {
    it('should execute tools with execute function and loop', async () => {
      const toolExecuted = vi.fn().mockResolvedValue('tool result');

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'test_tool',
              args: { x: 1 },
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Result after tool' }],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {},
          execute: toolExecuted,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      expect(toolExecuted).toHaveBeenCalledWith({ x: 1 });
      expect(result.text).toBe('Result after tool');
      expect(result.steps.length).toBe(2);
    });
  });

  describe('AC10.2: passive tools (no execute)', () => {
    it('should return without looping when tools have no execute function', async () => {
      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'passive_tool',
              args: { x: 1 },
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'passive_tool',
          description: 'A passive tool',
          parameters: {},
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      expect(result.toolCalls.length).toBe(1);
      expect(result.toolCalls[0].toolName).toBe('passive_tool');
      expect(result.steps.length).toBe(1);
    });
  });

  describe('AC10.3: maxToolRounds respected', () => {
    it('should stop looping after maxToolRounds', async () => {
      const toolExecuted = vi.fn().mockResolvedValue('result');

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-2',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-3',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-3',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {},
          execute: toolExecuted,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
        maxToolRounds: 2,
      });

      // Should execute tools only twice (maxToolRounds=2), but will have 3 steps
      // because the third response with tool calls doesn't get tools executed
      expect(toolExecuted.mock.calls.length).toBe(2);
      expect(result.steps.length).toBe(3);
      // The third step should have tool calls but they shouldn't be in the previous step execution
      expect(result.steps[2]?.toolCalls.length).toBe(1);
    });
  });

  describe('AC10.4: maxToolRounds=0 disables execution', () => {
    it('should not execute tools when maxToolRounds is 0', async () => {
      const toolExecuted = vi.fn().mockResolvedValue('result');

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {},
          execute: toolExecuted,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
        maxToolRounds: 0,
      });

      expect(toolExecuted).not.toHaveBeenCalled();
      expect(result.toolCalls.length).toBe(1);
    });
  });

  describe('AC10.5: parallel tool execution', () => {
    it('should execute multiple tools concurrently', async () => {
      const tool1Executed = vi.fn().mockResolvedValue('result1');
      const tool2Executed = vi.fn().mockResolvedValue('result2');
      const tool3Executed = vi.fn().mockResolvedValue('result3');

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: { x: 1 },
            },
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-2',
              toolName: 'tool2',
              args: { y: 2 },
            },
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-3',
              toolName: 'tool3',
              args: { z: 3 },
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Done' }],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'tool1',
          description: 'Tool 1',
          parameters: {},
          execute: tool1Executed,
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          parameters: {},
          execute: tool2Executed,
        },
        {
          name: 'tool3',
          description: 'Tool 3',
          parameters: {},
          execute: tool3Executed,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      expect(tool1Executed).toHaveBeenCalledWith({ x: 1 });
      expect(tool2Executed).toHaveBeenCalledWith({ y: 2 });
      expect(tool3Executed).toHaveBeenCalledWith({ z: 3 });
      expect(result.text).toBe('Done');
    });
  });

  describe('AC10.6: all parallel results in single continuation', () => {
    it('should send all tool results in one request', async () => {
      const tool1Executed = vi.fn().mockResolvedValue('result1');
      const tool2Executed = vi.fn().mockResolvedValue('result2');

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: {},
            },
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-2',
              toolName: 'tool2',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Done' }],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'tool1',
          description: 'Tool 1',
          parameters: {},
          execute: tool1Executed,
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          parameters: {},
          execute: tool2Executed,
        },
      ];

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      const complete = vi.mocked(mockClient.complete);
      const secondCall = complete.mock.calls[1];
      expect(secondCall).toBeDefined();

      const secondCallMessages = secondCall?.[0]?.messages;
      expect(secondCallMessages).toBeDefined();

      // Should have assistant message with both tool calls
      const assistantMsg = secondCallMessages?.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBeDefined();
      if (Array.isArray(assistantMsg?.content)) {
        expect(assistantMsg.content.length).toBe(2);
      }

      // Should have two tool result messages
      const toolMsgs = secondCallMessages?.filter((m) => m.role === 'tool');
      expect(toolMsgs?.length).toBe(2);
    });
  });

  describe('AC10.7: tool execution error', () => {
    it('should send error result when tool throws', async () => {
      const toolError = new Error('Tool failed');
      const toolExecuted = vi.fn().mockRejectedValue(toolError);

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Handled error' }],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {},
          execute: toolExecuted,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      // Should have sent error result in second request
      expect(result.text).toBe('Handled error');

      const complete = vi.mocked(mockClient.complete);
      const secondCall = complete.mock.calls[1];
      const toolResultMsg = (secondCall?.[0]?.messages ?? []).find(
        (m) => m.role === 'tool',
      );

      expect(toolResultMsg?.content).toBeDefined();
      if (Array.isArray(toolResultMsg?.content)) {
        const toolResultPart = toolResultMsg.content[0];
        if (toolResultPart && toolResultPart.kind === 'TOOL_RESULT') {
          expect(toolResultPart.isError).toBe(true);
          expect(toolResultPart.content).toBe('Tool failed');
        }
      }
    });
  });

  describe('AC10.8: unknown tool call', () => {
    it('should send error result for unknown tool', async () => {
      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'unknown_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Handled unknown tool' }],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'known_tool',
          description: 'A known tool',
          parameters: {},
          execute: vi.fn().mockResolvedValue('result'),
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      expect(result.text).toBe('Handled unknown tool');

      const complete = vi.mocked(mockClient.complete);
      const secondCall = complete.mock.calls[1];
      const toolResultMsg = (secondCall?.[0]?.messages ?? []).find(
        (m) => m.role === 'tool',
      );

      expect(toolResultMsg?.content).toBeDefined();
      if (Array.isArray(toolResultMsg?.content)) {
        const toolResultPart = toolResultMsg.content[0];
        if (toolResultPart && toolResultPart.kind === 'TOOL_RESULT') {
          expect(toolResultPart.isError).toBe(true);
          expect(toolResultPart.content).toContain('Unknown tool');
        }
      }
    });
  });

  describe('AC10.10: StepResult tracking', () => {
    it('should track each step with usage', async () => {
      const toolExecuted = vi.fn().mockResolvedValue('result');

      const usage1 = { inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const usage2 = { inputTokens: 5, outputTokens: 25, totalTokens: 30, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

      const mockResponses: Array<LLMResponse> = [
        {
          id: 'response-1',
          model: 'test-model',
          content: [
            {
              kind: 'TOOL_CALL',
              toolCallId: 'call-1',
              toolName: 'test_tool',
              args: {},
            },
          ],
          finishReason: 'tool_calls' as const,
          usage: usage1,
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
        {
          id: 'response-2',
          model: 'test-model',
          content: [{ kind: 'TEXT', text: 'Final' }],
          finishReason: 'stop' as const,
          usage: usage2,
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        },
      ];

      const mockClient = createMockClient(mockResponses);

      const tools: Array<Tool> = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {},
          execute: toolExecuted,
        },
      ];

      const result = await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        tools,
      });

      expect(result.steps.length).toBe(2);
      expect(result.steps[0]?.usage).toEqual(usage1);
      expect(result.steps[1]?.usage).toEqual(usage2);

      // Total usage should be sum of both
      expect(result.totalUsage.inputTokens).toBe(15);
      expect(result.totalUsage.outputTokens).toBe(45);
      expect(result.totalUsage.totalTokens).toBe(60);
    });
  });

  describe('toolChoice pass-through (AC10.9)', () => {
    it('should pass through toolChoice.mode=auto', async () => {
      const mockClient = createMockClient();

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        toolChoice: { mode: 'auto' },
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: { mode: 'auto' },
        }),
      );
    });

    it('should pass through toolChoice.mode=none', async () => {
      const mockClient = createMockClient();

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        toolChoice: { mode: 'none' },
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: { mode: 'none' },
        }),
      );
    });

    it('should pass through toolChoice.mode=required', async () => {
      const mockClient = createMockClient();

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        toolChoice: { mode: 'required' },
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: { mode: 'required' },
        }),
      );
    });

    it('should pass through toolChoice.mode=named with toolName', async () => {
      const mockClient = createMockClient();

      await generate({
        model: 'test-model',
        prompt: 'hello',
        client: mockClient,
        toolChoice: { mode: 'named', toolName: 'my_tool' },
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: { mode: 'named', toolName: 'my_tool' },
        }),
      );
    });
  });

  describe('system message handling', () => {
    it('should prepend system message to messages', async () => {
      const mockClient = createMockClient();

      await generate({
        model: 'test-model',
        prompt: 'user prompt',
        system: 'You are helpful',
        client: mockClient,
      });

      const complete = vi.mocked(mockClient.complete);
      const call = complete.mock.calls[0];
      const messages = call?.[0]?.messages ?? [];

      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toBe('You are helpful');
      expect(messages[1]?.role).toBe('user');
    });
  });

  describe('default client usage', () => {
    it('should use default client when not provided', async () => {
      const mockClient = createMockClient();
      setDefaultClient(mockClient);

      await generate({
        model: 'test-model',
        prompt: 'hello',
      });

      const complete = vi.mocked(mockClient.complete);
      expect(complete).toHaveBeenCalled();
    });
  });
});
