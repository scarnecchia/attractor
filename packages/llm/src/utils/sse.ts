import { EventSourceParserStream } from 'eventsource-parser/stream';
import { StreamError } from '../types/error.js';

export type SSEEvent = {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
};

/**
 * Creates an async iterable of SSE events from a Response body.
 * Pipes the response body through EventSourceParserStream and yields parsed events.
 */
export async function* createSSEStream(
  response: globalThis.Response,
): AsyncIterable<SSEEvent> {
  const body = response.body;
  if (!body) {
    throw new StreamError('Response body is null or undefined');
  }

  try {
    const parserStream = new EventSourceParserStream();
    // The response body is a Uint8Array stream, need to decode to string first
    const decodedStream = body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(parserStream);
    const reader = decodedStream.getReader();

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        const event: SSEEvent = {
          event: value.event || '',
          data: value.data || '',
          ...(value.id && { id: value.id }),
        };

        yield event;
      }
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    if (err instanceof StreamError) {
      throw err;
    }
    throw new StreamError(
      `Failed to parse SSE stream: ${err instanceof Error ? err.message : 'Unknown error'}`,
      err instanceof Error ? err : undefined,
    );
  }
}
