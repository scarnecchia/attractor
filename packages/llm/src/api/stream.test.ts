import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Client,
  LLMResponse,
  StreamEvent,
  Tool,
} from '../index.js';
import { stream, StreamAccumulator, type StreamOptions } from './stream.js';
import { emptyUsage, AbortError, ServerError } from '../types/index.js';
import { resetDefaultClient } from '../client/default-client.js';

function createMockClient(
  streamEvents: Array<Array<StreamEvent>> = [],
): Client {
  const mockStreams = streamEvents.length > 0
    ? streamEvents
    : [
      [
        {
          type: 'STREAM_START' as const,
          id: 'stream-1',
          model: 'test-model',
        },
        {
          type: 'TEXT_DELTA' as const,
          text: 'Hello ',
        },
        {
          type: 'TEXT_DELTA' as const,
          text: 'World',
        },
        {
          type: 'FINISH' as const,
          finishReason: 'stop' as const,
          usage: emptyUsage(),
        },
      ],
    ];

  let streamIndex = 0;

  async function* defaultStream(): AsyncGenerator<StreamEvent> {
    const events = mockStreams[Math.min(streamIndex, mockStreams.length - 1)] ?? [];
    streamIndex += 1;
    for (const event of events) {
      yield event;
    }
  }

  return {
    name: 'test',
    complete: vi.fn(),
    stream: vi.fn(defaultStream),
    close: vi.fn(),
  } as unknown as Client;
}

describe('StreamAccumulator', () => {
  describe('accumulate and convert', () => {
    it('should accumulate TEXT_DELTA events', () => {
      const acc = new StreamAccumulator();
      acc.process({
        type: 'STREAM_START',
        id: 'test-1',
        model: 'gpt-4',
      });
      acc.process({
        type: 'TEXT_DELTA',
        text: 'Hello ',
      });
      acc.process({
        type: 'TEXT_DELTA',
        text: 'World',
      });
      acc.process({
        type: 'FINISH',
        finishReason: 'stop',
        usage: emptyUsage(),
      });

      const response = acc.toResponse();
      expect(response.id).toBe('test-1');
      expect(response.model).toBe('gpt-4');
      expect(response.content[0]).toEqual({
        kind: 'TEXT',
        text: 'Hello World',
      });
      expect(response.finishReason).toBe('stop');
    });

    it('should accumulate THINKING_DELTA events', () => {
      const acc = new StreamAccumulator();
      acc.process({
        type: 'STREAM_START',
        id: 'test-1',
        model: 'gpt-4',
      });
      acc.process({
        type: 'THINKING_DELTA',
        text: 'Let me think...',
      });
      acc.process({
        type: 'FINISH',
        finishReason: 'stop',
        usage: emptyUsage(),
      });

      const response = acc.toResponse();
      const thinkingContent = response.content.find((c) => c.kind === 'THINKING');
      expect(thinkingContent).toEqual({
        kind: 'THINKING',
        text: 'Let me think...',
        signature: null,
      });
    });

    it('should accumulate tool calls', () => {
      const acc = new StreamAccumulator();
      acc.process({
        type: 'STREAM_START',
        id: 'test-1',
        model: 'gpt-4',
      });
      acc.process({
        type: 'TOOL_CALL_START',
        toolCallId: 'call-1',
        toolName: 'search',
      });
      acc.process({
        type: 'TOOL_CALL_DELTA',
        toolCallId: 'call-1',
        argsDelta: '{"q',
      });
      acc.process({
        type: 'TOOL_CALL_DELTA',
        toolCallId: 'call-1',
        argsDelta: '":"hello"}',
      });
      acc.process({
        type: 'TOOL_CALL_END',
        toolCallId: 'call-1',
      });
      acc.process({
        type: 'FINISH',
        finishReason: 'tool_calls',
        usage: emptyUsage(),
      });

      const response = acc.toResponse();
      const toolCall = response.content.find((c) => c.kind === 'TOOL_CALL');
      expect(toolCall).toEqual({
        kind: 'TOOL_CALL',
        toolCallId: 'call-1',
        toolName: 'search',
        args: { q: 'hello' },
      });
    });

    it('should handle invalid JSON in tool call args gracefully', () => {
      const acc = new StreamAccumulator();
      acc.process({
        type: 'STREAM_START',
        id: 'test-1',
        model: 'gpt-4',
      });
      acc.process({
        type: 'TOOL_CALL_START',
        toolCallId: 'call-1',
        toolName: 'search',
      });
      acc.process({
        type: 'TOOL_CALL_DELTA',
        toolCallId: 'call-1',
        argsDelta: 'invalid json',
      });
      acc.process({
        type: 'TOOL_CALL_END',
        toolCallId: 'call-1',
      });
      acc.process({
        type: 'FINISH',
        finishReason: 'tool_calls',
        usage: emptyUsage(),
      });

      const response = acc.toResponse();
      const toolCall = response.content.find((c) => c.kind === 'TOOL_CALL');
      expect(toolCall?.kind).toBe('TOOL_CALL');
      if (toolCall?.kind === 'TOOL_CALL') {
        expect(toolCall.args).toEqual({});
      }
    });
  });
});

describe('stream()', () => {
  beforeEach(() => {
    resetDefaultClient();
  });

  afterEach(() => {
    resetDefaultClient();
  });

  describe('AC5.4: TEXT_DELTA events accumulate to full response', () => {
    it('should collect all TEXT_DELTA events into full text', async () => {
      const streamEvents: Array<Array<StreamEvent>> = [
        [
          { type: 'STREAM_START', id: 'test-1', model: 'test-model' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'TEXT_DELTA', text: ' ' },
          { type: 'TEXT_DELTA', text: 'World' },
          { type: 'FINISH', finishReason: 'stop', usage: emptyUsage() },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({ model: 'test-model', prompt: 'hi', client: mockClient });

      const events: Array<StreamEvent> = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'TEXT_DELTA')).toHaveLength(3);
      const response = await result.response();
      expect(response.content[0]).toEqual({
        kind: 'TEXT',
        text: 'Hello World',
      });
    });
  });

  describe('AC5.5: STREAM_START and FINISH events with metadata', () => {
    it('should yield STREAM_START first with id and model', async () => {
      const streamEvents: Array<Array<StreamEvent>> = [
        [
          {
            type: 'STREAM_START',
            id: 'test-1',
            model: 'gpt-4',
          },
          { type: 'TEXT_DELTA', text: 'hello' },
          {
            type: 'FINISH',
            finishReason: 'stop',
            usage: emptyUsage(),
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({ model: 'gpt-4', prompt: 'test', client: mockClient });

      const events: Array<StreamEvent> = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      expect(events[0]).toEqual({
        type: 'STREAM_START',
        id: 'test-1',
        model: 'gpt-4',
      });

      const finishEvent = events.find((e) => e.type === 'FINISH');
      expect(finishEvent?.type).toBe('FINISH');
      if (finishEvent?.type === 'FINISH') {
        expect(finishEvent.finishReason).toBe('stop');
      }
    });
  });

  describe('AC5.6: StreamAccumulator produces equivalent response to complete()', () => {
    it('should produce response equivalent to complete()', async () => {
      const streamEvents: Array<Array<StreamEvent>> = [
        [
          {
            type: 'STREAM_START',
            id: 'stream-123',
            model: 'test-model',
          },
          { type: 'TEXT_DELTA', text: 'Response ' },
          { type: 'TEXT_DELTA', text: 'text' },
          {
            type: 'FINISH',
            finishReason: 'stop',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({ model: 'test-model', prompt: 'test', client: mockClient });

      for await (const _event of result.stream) {
        // consume stream
      }

      const response = await result.response();

      expect(response.id).toBe('stream-123');
      expect(response.model).toBe('test-model');
      expect(response.content[0]).toEqual({
        kind: 'TEXT',
        text: 'Response text',
      });
      expect(response.finishReason).toBe('stop');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
    });
  });

  describe('textStream: only yields text strings', () => {
    it('should filter to TEXT_DELTA events and yield only text', async () => {
      const streamEvents: Array<Array<StreamEvent>> = [
        [
          { type: 'STREAM_START', id: 'test-1', model: 'test-model' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'TEXT_DELTA', text: ' ' },
          { type: 'THINKING_DELTA', text: 'thinking...' },
          { type: 'TEXT_DELTA', text: 'World' },
          {
            type: 'FINISH',
            finishReason: 'stop',
            usage: emptyUsage(),
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({ model: 'test-model', prompt: 'hi', client: mockClient });

      const textParts: Array<string> = [];
      for await (const text of result.textStream) {
        textParts.push(text);
      }

      expect(textParts).toEqual(['Hello', ' ', 'World']);
    });
  });

  describe('Tool loop in streaming', () => {
    it('should execute active tools and continue streaming', async () => {
      const tool: Tool = {
        name: 'get_info',
        description: 'Get info',
        parameters: {},
        execute: vi.fn().mockResolvedValue('info result'),
      };

      const streamEvents: Array<Array<StreamEvent>> = [
        [
          { type: 'STREAM_START', id: 'stream-1', model: 'test-model' },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'call-1',
            toolName: 'get_info',
          },
          {
            type: 'TOOL_CALL_DELTA',
            toolCallId: 'call-1',
            argsDelta: '{}',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'call-1',
          },
          {
            type: 'FINISH',
            finishReason: 'tool_calls',
            usage: emptyUsage(),
          },
        ],
        [
          { type: 'STREAM_START', id: 'stream-2', model: 'test-model' },
          { type: 'TEXT_DELTA', text: 'Got info' },
          {
            type: 'FINISH',
            finishReason: 'stop',
            usage: emptyUsage(),
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({
        model: 'test-model',
        prompt: 'test',
        client: mockClient,
        tools: [tool],
      });

      const events: Array<StreamEvent> = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Should have STEP_FINISH event between tool call finish and next stream start
      const stepFinishEvent = events.find((e) => e.type === 'STEP_FINISH');
      expect(stepFinishEvent?.type).toBe('STEP_FINISH');

      // Tool should have been executed
      expect(tool.execute).toHaveBeenCalledWith({});

      // Final response should have text from second stream
      const response = await result.response();
      expect(response.content[0]).toEqual({
        kind: 'TEXT',
        text: 'Got info',
      });
    });

    it('should not execute passive tools', async () => {
      const tool: Tool = {
        name: 'get_info',
        description: 'Get info',
        parameters: {},
        // no execute function = passive tool
      };

      const streamEvents: Array<Array<StreamEvent>> = [
        [
          { type: 'STREAM_START', id: 'stream-1', model: 'test-model' },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'call-1',
            toolName: 'get_info',
          },
          {
            type: 'TOOL_CALL_DELTA',
            toolCallId: 'call-1',
            argsDelta: '{"arg":"value"}',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'call-1',
          },
          {
            type: 'FINISH',
            finishReason: 'tool_calls',
            usage: emptyUsage(),
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({
        model: 'test-model',
        prompt: 'test',
        client: mockClient,
        tools: [tool],
      });

      for await (const _event of result.stream) {
        // consume
      }

      // Should only have one stream call (no continuation)
      const streamCalls = vi.mocked(mockClient.stream).mock.calls;
      expect(streamCalls).toHaveLength(1);
    });

    it('should respect maxToolRounds limit', async () => {
      const tool: Tool = {
        name: 'compute',
        description: 'Compute',
        parameters: {},
        execute: vi.fn().mockResolvedValue('result'),
      };

      // Three consecutive tool call responses
      const streamEvents: Array<Array<StreamEvent>> = [
        [
          { type: 'STREAM_START', id: 'stream-1', model: 'test-model' },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'call-1',
            toolName: 'compute',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'call-1',
          },
          {
            type: 'FINISH',
            finishReason: 'tool_calls',
            usage: emptyUsage(),
          },
        ],
        [
          { type: 'STREAM_START', id: 'stream-2', model: 'test-model' },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'call-2',
            toolName: 'compute',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'call-2',
          },
          {
            type: 'FINISH',
            finishReason: 'tool_calls',
            usage: emptyUsage(),
          },
        ],
        [
          { type: 'STREAM_START', id: 'stream-3', model: 'test-model' },
          { type: 'TEXT_DELTA', text: 'done' },
          {
            type: 'FINISH',
            finishReason: 'stop',
            usage: emptyUsage(),
          },
        ],
      ];

      const mockClient = createMockClient(streamEvents);
      const result = stream({
        model: 'test-model',
        prompt: 'test',
        client: mockClient,
        tools: [tool],
        maxToolRounds: 2,
      });

      for await (const _event of result.stream) {
        // consume
      }

      // Should execute tool twice then stop
      expect(tool.execute).toHaveBeenCalledTimes(2);

      const streamCalls = vi.mocked(mockClient.stream).mock.calls;
      // One initial + two tool continuations = 3 calls
      expect(streamCalls.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Abort during stream', () => {
    it('should abort stream when signal is aborted', async () => {
      const abortController = new AbortController();

      async function* abortingStream(): AsyncGenerator<StreamEvent> {
        yield {
          type: 'STREAM_START',
          id: 'test-1',
          model: 'test-model',
        };
        abortController.abort();
        throw new AbortError('Aborted');
      }

      const mockClient = {
        name: 'test',
        complete: vi.fn(),
        stream: vi.fn(abortingStream),
        close: vi.fn(),
      } as unknown as Client;

      const result = stream({
        model: 'test-model',
        prompt: 'test',
        client: mockClient,
        signal: abortController.signal,
      });

      try {
        for await (const _event of result.stream) {
          // consume
        }
        expect.fail('should have thrown AbortError');
      } catch (error) {
        expect(error).toBeInstanceOf(AbortError);
      }
    });
  });

  describe('AC7.6: Streaming does not retry after partial data', () => {
    it('should not retry stream after yielding partial TEXT_DELTA then failing', async () => {
      let streamCallCount = 0;

      async function* partialStream(): AsyncGenerator<StreamEvent> {
        streamCallCount += 1;

        yield {
          type: 'STREAM_START',
          id: 'test-1',
          model: 'test-model',
        };

        yield {
          type: 'TEXT_DELTA',
          text: 'Partial ',
        };

        yield {
          type: 'TEXT_DELTA',
          text: 'response',
        };

        throw new ServerError('Transient server error', 500, 'test');
      }

      const mockClient = {
        name: 'test',
        complete: vi.fn(),
        stream: vi.fn(partialStream),
        close: vi.fn(),
      } as unknown as Client;

      const result = stream({
        model: 'test-model',
        prompt: 'test',
        client: mockClient,
      });

      let collectedText = '';
      let errorThrown = false;

      try {
        for await (const event of result.stream) {
          if (event.type === 'TEXT_DELTA') {
            collectedText += event.text;
          }
        }
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(ServerError);
      }

      expect(errorThrown).toBe(true);
      expect(collectedText).toBe('Partial response');
      expect(streamCallCount).toBe(1);
    });
  });
});
