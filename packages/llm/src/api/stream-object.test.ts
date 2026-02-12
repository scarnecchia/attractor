import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamEvent, LLMResponse } from '../types/index.js';
import { NoObjectGeneratedError, emptyUsage } from '../types/index.js';
import type { Client } from '../client/index.js';
import { streamObject } from './stream-object.js';

// Mock client that returns a stream of events
function createMockClient(events: Array<StreamEvent>): Client {
  const mockClient = {
    resolveProviderName: vi.fn((request) => request.provider ?? 'openai'),
    complete: vi.fn(),
    stream: vi.fn(function* () {
      for (const event of events) {
        yield event;
      }
    }),
    close: vi.fn(),
  } as unknown as Client;

  return mockClient;
}

// Helper to create TEXT_DELTA events
function textDelta(text: string): StreamEvent {
  return {
    type: 'TEXT_DELTA',
    text,
  };
}

// Helper to create TOOL_CALL_DELTA events
function toolCallDelta(toolCallId: string, argsDelta: string): StreamEvent {
  return {
    type: 'TOOL_CALL_DELTA',
    toolCallId,
    argsDelta,
  };
}

// Helper to create STREAM_START events
function streamStart(id: string = 'test-id', model: string = 'gpt-4'): StreamEvent {
  return {
    type: 'STREAM_START',
    id,
    model,
  };
}

// Helper to create FINISH events
function streamFinish(): StreamEvent {
  return {
    type: 'FINISH',
    finishReason: 'stop',
    usage: emptyUsage(),
  };
}

describe('streamObject', () => {
  describe('AC11.6: yields progressively larger partial objects', () => {
    it('yields partial objects as TEXT_DELTA events accumulate and are parsed', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"name": "'),
        textDelta('Ali'),
        textDelta('ce", "age": '),
        textDelta('30}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);

      const result = streamObject<{ name: string; age: number }>({
        model: 'gpt-4',
        schema,
        client: mockClient,
      });

      const partials: Array<Partial<{ name: string; age: number }>> = [];
      for await (const partial of result.stream) {
        partials.push(partial);
      }

      // Should have yielded progressively larger objects
      expect(partials.length).toBeGreaterThan(0);

      // Should have progressively larger fields
      // First might be empty name or partial name
      expect(partials[0]).toBeDefined();

      // Last partial should be complete
      const lastPartial = partials[partials.length - 1];
      expect(lastPartial).toEqual({ name: 'Alice', age: 30 });

      // Verify we had a progression (not all the same)
      const uniquePartials = new Set(partials.map((p) => JSON.stringify(p)));
      expect(uniquePartials.size).toBeGreaterThan(1);
    });

    it('de-duplicates identical partials from repeated partial-json results', async () => {
      const schema = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
      };

      // Create deltas that would result in the same partial twice in a row
      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"v'),
        textDelta('a'),
        textDelta('lue'),
        textDelta('": "test"}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);

      const result = streamObject<{ value: string }>({
        model: 'gpt-4',
        schema,
        client: mockClient,
      });

      const partials: Array<Partial<{ value: string }>> = [];
      for await (const partial of result.stream) {
        partials.push(partial);
      }

      // Should have deduplicated, so count should be reasonable (not yielding every single delta)
      expect(partials.length).toBeGreaterThan(0);

      // Last partial should be complete
      expect(partials[partials.length - 1]).toEqual({ value: 'test' });
    });
  });

  describe('AC11.7: final object() validates against schema', () => {
    it('resolves object() promise with fully validated object when stream completes', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"name": "Alice", "age": 30}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);

      const result = streamObject<{ name: string; age: number }>({
        model: 'gpt-4',
        schema,
        client: mockClient,
      });

      // Consume the stream first
      const partials: Array<unknown> = [];
      for await (const partial of result.stream) {
        partials.push(partial);
      }

      // Then call object()
      const obj = await result.object();

      expect(obj).toEqual({ name: 'Alice', age: 30 });
    });

    it('throws NoObjectGeneratedError if final JSON is malformed', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{invalid json'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);

      const result = streamObject<{ name: string }>({
        model: 'gpt-4',
        schema,
        client: mockClient,
      });

      // Consume the stream
      for await (const _partial of result.stream) {
        // Just iterate
      }

      // Calling object() should throw
      await expect(result.object()).rejects.toThrow(NoObjectGeneratedError);
    });

    it('throws NoObjectGeneratedError if final JSON missing required field', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"name": "Alice"}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);

      const result = streamObject<{ name: string; age: number }>({
        model: 'gpt-4',
        schema,
        client: mockClient,
      });

      // Consume the stream
      for await (const _partial of result.stream) {
        // Just iterate
      }

      // Calling object() should throw because 'age' is missing
      await expect(result.object()).rejects.toThrow(NoObjectGeneratedError);
    });
  });

  describe('Anthropic strategy with TOOL_CALL_DELTA', () => {
    it('accumulates TOOL_CALL_DELTA events and yields partials', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        {
          type: 'TOOL_CALL_START',
          toolCallId: 'tc_1',
          toolName: '__extract',
        },
        toolCallDelta('tc_1', '{"na'),
        toolCallDelta('tc_1', 'me": "Ali'),
        toolCallDelta('tc_1', 'ce", "ag'),
        toolCallDelta('tc_1', 'e": 30}'),
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tc_1',
        },
        streamFinish(),
      ];

      // Mock client that returns these events
      const mockClient = {
        resolveProviderName: vi.fn(() => 'anthropic'),
        stream: vi.fn(function* () {
          for (const event of events) {
            yield event;
          }
        }),
        close: vi.fn(),
      } as unknown as Client;

      const result = streamObject<{ name: string; age: number }>({
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        schema,
        client: mockClient,
      });

      const partials: Array<Partial<{ name: string; age: number }>> = [];
      for await (const partial of result.stream) {
        partials.push(partial);
      }

      // Should have accumulated from TOOL_CALL_DELTA events
      expect(partials.length).toBeGreaterThan(0);

      // Final partial should be complete
      expect(partials[partials.length - 1]).toEqual({ name: 'Alice', age: 30 });

      // Verify object() also works
      const obj = await result.object();
      expect(obj).toEqual({ name: 'Alice', age: 30 });
    });
  });

  describe('provider strategy detection', () => {
    it('uses TEXT_DELTA accumulation for OpenAI', async () => {
      const schema = {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"value": "test"}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);
      mockClient.resolveProviderName = vi.fn(() => 'openai');

      const result = streamObject<{ value: string }>({
        model: 'gpt-4',
        provider: 'openai',
        schema,
        client: mockClient,
      });

      for await (const _partial of result.stream) {
        // Consume
      }

      const obj = await result.object();
      expect(obj).toEqual({ value: 'test' });
    });

    it('uses TEXT_DELTA accumulation for Gemini', async () => {
      const schema = {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      };

      const events: Array<StreamEvent> = [
        streamStart(),
        textDelta('{"value": "test"}'),
        streamFinish(),
      ];

      const mockClient = createMockClient(events);
      mockClient.resolveProviderName = vi.fn(() => 'gemini');

      const result = streamObject<{ value: string }>({
        model: 'gemini-2.0-flash',
        provider: 'gemini',
        schema,
        client: mockClient,
      });

      for await (const _partial of result.stream) {
        // Consume
      }

      const obj = await result.object();
      expect(obj).toEqual({ value: 'test' });
    });
  });
});
