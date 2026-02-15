import type { SessionEvent } from '../types/index.js';

export type SessionEventEmitter = {
  readonly emit: (event: SessionEvent) => void;
  readonly complete: () => void;
  readonly error: (err: Error) => void;
  readonly iterator: () => AsyncIterable<SessionEvent>;
};

export function createSessionEventEmitter(): SessionEventEmitter {
  const buffer: SessionEvent[] = [];
  let waiter: ((result: IteratorResult<SessionEvent> | Error) => void) | null = null;
  let done = false;
  let pendingError: Error | null = null;

  const asyncIterator: AsyncIterator<SessionEvent> = {
    next: async (): Promise<IteratorResult<SessionEvent>> => {
      if (buffer.length > 0) {
        return { value: buffer.shift()!, done: false };
      }

      if (pendingError) {
        const err = pendingError;
        pendingError = null;
        throw err;
      }

      if (done) {
        return { done: true, value: undefined };
      }

      return new Promise<IteratorResult<SessionEvent>>((resolve, reject) => {
        waiter = (result) => {
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result as IteratorResult<SessionEvent>);
          }
        };
      });
    },
  };

  return {
    emit: (event: SessionEvent) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value: event, done: false });
      } else {
        buffer.push(event);
      }
    },

    complete: () => {
      done = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ done: true, value: undefined });
      }
    },

    error: (err: Error) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(err);
      } else {
        pendingError = err;
      }
    },

    iterator: () => ({
      [Symbol.asyncIterator]: () => asyncIterator,
    }),
  };
}
