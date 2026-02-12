import { describe, it, expect } from 'vitest';
import { createSSEStream, type SSEEvent } from './sse.js';

/**
 * Creates a mock Response with a ReadableStream body from SSE-formatted strings.
 */
function createMockResponse(sseLines: string[]): globalThis.Response {
  const content = sseLines.join('\n');
  const encoder = new TextEncoder();
  const encodedContent = encoder.encode(content);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encodedContent);
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

describe('createSSEStream', () => {
  it('parses single SSE event', async () => {
    const response = createMockResponse([
      'event: message',
      'data: hello',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('message');
    expect(events[0]?.data).toBe('hello');
    expect(events[0]?.id).toBeUndefined();
  });

  it('parses multiple SSE events in sequence', async () => {
    const response = createMockResponse([
      'event: start',
      'data: first',
      '',
      'event: middle',
      'data: second',
      '',
      'event: end',
      'data: third',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.event).toBe('start');
    expect(events[0]?.data).toBe('first');
    expect(events[1]?.event).toBe('middle');
    expect(events[1]?.data).toBe('second');
    expect(events[2]?.event).toBe('end');
    expect(events[2]?.data).toBe('third');
  });

  it('handles multi-line data with newlines', async () => {
    const response = createMockResponse([
      'event: multiline',
      'data: line1',
      'data: line2',
      'data: line3',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('line1\nline2\nline3');
  });

  it('preserves event type field', async () => {
    const response = createMockResponse([
      'event: delta',
      'data: incremental',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.event).toBe('delta');
  });

  it('handles default event type when not specified', async () => {
    const response = createMockResponse(['data: test', '', '']);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.event).toBe('');
  });

  it('completes normally after all events', async () => {
    const response = createMockResponse([
      'event: first',
      'data: value',
      '',
      '',
    ]);

    let eventCount = 0;
    for await (const _event of createSSEStream(response)) {
      eventCount++;
    }

    expect(eventCount).toBe(1);
  });

  it('handles empty data lines', async () => {
    const response = createMockResponse(['data:', '', '']);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('');
  });

  it('includes id field when present', async () => {
    const response = createMockResponse([
      'event: message',
      'data: content',
      'id: msg-123',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.id).toBe('msg-123');
  });

  it('omits id field when not present', async () => {
    const response = createMockResponse([
      'event: message',
      'data: content',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.id).toBeUndefined();
  });

  it('throws when response body is null', async () => {
    const response = new Response(null, { status: 200 });

    const iterator = createSSEStream(response);
    await expect(async () => {
      // eslint-disable-next-line no-unreachable-loop
      for await (const _event of iterator) {
        // consume events
      }
    }).rejects.toThrow();
  });

  it('handles JSON data in events', async () => {
    const response = createMockResponse([
      'event: message',
      'data: {"text":"hello","value":42}',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.data).toBe('{"text":"hello","value":42}');
    const parsed = JSON.parse(events[0]?.data || '{}');
    expect(parsed).toEqual({ text: 'hello', value: 42 });
  });

  it('handles comments (ignored by parser)', async () => {
    const response = createMockResponse([
      ': this is a comment',
      'event: message',
      'data: content',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    // Comments are ignored, only the message event should be present
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('message');
  });

  it('handles stream with mixed fields', async () => {
    const response = createMockResponse([
      'event: complete',
      'id: evt-001',
      'data: full event',
      '',
      '',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of createSSEStream(response)) {
      events.push(event);
    }

    expect(events[0]?.event).toBe('complete');
    expect(events[0]?.id).toBe('evt-001');
    expect(events[0]?.data).toBe('full event');
  });
});
