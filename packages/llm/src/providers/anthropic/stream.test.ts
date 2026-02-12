import { describe, it, expect } from 'vitest';
import { translateStream } from './stream.js';
import type { SSEEvent } from '../../utils/sse.js';
import type { StreamEvent } from '../../types/index.js';

async function* mockSSEStream(events: Array<SSEEvent>): AsyncIterable<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

describe('Anthropic Stream Translation', () => {
  describe('Stream start event', () => {
    it('should yield STREAM_START on message_start event', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg-123',
              model: 'claude-opus-4-6',
            },
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      expect(results).toHaveLength(1);
      const start = results[0] as Record<string, unknown>;
      expect(start['type']).toBe('STREAM_START');
      expect(start['id']).toBe('msg-123');
      expect(start['model']).toBe('claude-opus-4-6');
    });
  });

  describe('Text delta events', () => {
    it('should yield TEXT_DELTA on text_delta event', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_start',
            content_block: { type: 'text' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'hello' },
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const textDelta = results.find((e) => e.type === 'TEXT_DELTA') as Record<string, unknown> | undefined;
      expect(textDelta).toBeDefined();
      expect(textDelta!['text']).toBe('hello');
    });
  });

  describe('Tool call events', () => {
    it('should yield TOOL_CALL_START and TOOL_CALL_END for tool_use blocks', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'call-123', name: 'get_weather' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"loc' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_stop',
            index: 1,
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const startEvent = results.find((e) => e.type === 'TOOL_CALL_START') as Record<string, unknown> | undefined;
      expect(startEvent).toBeDefined();
      expect(startEvent!['toolCallId']).toBe('call-123');
      expect(startEvent!['toolName']).toBe('get_weather');

      const deltaEvent = results.find((e) => e.type === 'TOOL_CALL_DELTA');
      expect(deltaEvent).toBeDefined();

      const endEvent = results.find((e) => e.type === 'TOOL_CALL_END') as Record<string, unknown> | undefined;
      expect(endEvent).toBeDefined();
      expect(endEvent!['toolCallId']).toBe('call-123');
    });
  });

  describe('Thinking delta events', () => {
    it('should yield THINKING_DELTA on thinking_delta event', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_start',
            content_block: { type: 'thinking' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'let me' },
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const thinkingDelta = results.find((e) => e.type === 'THINKING_DELTA') as Record<string, unknown> | undefined;
      expect(thinkingDelta).toBeDefined();
      expect(thinkingDelta!['text']).toBe('let me');
    });
  });

  describe('Finish event', () => {
    it('should yield FINISH with usage and finish reason on message_stop', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 50 },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'message_stop',
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const finishEvent = results.find((e) => e.type === 'FINISH') as Record<string, unknown> | undefined;
      expect(finishEvent).toBeDefined();
      expect(finishEvent!['finishReason']).toBe('stop');
      expect((finishEvent!['usage'] as Record<string, unknown>)['outputTokens']).toBe(50);
    });
  });

  describe('Usage accumulation', () => {
    it('should accumulate usage across message_delta events', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 50, cache_read_input_tokens: 100 },
          }),
        },
        { event: "message", data: JSON.stringify({
            type: 'message_stop',
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const finishEvent = results.find((e) => e.type === 'FINISH') as Record<string, unknown> | undefined;
      expect(finishEvent).toBeDefined();
      expect((finishEvent!['usage'] as Record<string, unknown>)['outputTokens']).toBe(50);
      expect((finishEvent!['usage'] as Record<string, unknown>)['cacheReadTokens']).toBe(100);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty stream', async () => {
      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream([]))) {
        results.push(event);
      }

      expect(results).toHaveLength(0);
    });

    it('should handle invalid JSON gracefully', async () => {
      const events: Array<SSEEvent> = [
        { event: "message", data: JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-123', model: 'claude-opus-4-6' },
          }),
        },
        {
          event: "",
          data: 'invalid json {]',
        },
        { event: "message", data: JSON.stringify({
            type: 'message_stop',
          }),
        },
      ];

      const results: Array<StreamEvent> = [];
      for await (const event of translateStream(mockSSEStream(events))) {
        results.push(event);
      }

      const starts = results.filter((e) => e.type === 'STREAM_START');
      expect(starts).toHaveLength(1);
    });
  });
});
