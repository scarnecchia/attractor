import { describe, it, expect } from 'vitest';
import { createSessionEventEmitter } from './events.js';

describe('SessionEventEmitter', () => {
  describe('async iterator consumption', () => {
    it('should deliver events via for await loop', async () => {
      const emitter = createSessionEventEmitter();
      const events: unknown[] = [];

      const iterator = emitter.iterator();

      setTimeout(() => {
        emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
        emitter.emit({ kind: 'ASSISTANT_TEXT_START' });
        emitter.emit({ kind: 'ASSISTANT_TEXT_DELTA', text: 'hello' });
        emitter.complete();
      }, 10);

      for await (const event of iterator) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: '1' });
      expect(events[1]).toEqual({ kind: 'ASSISTANT_TEXT_START' });
      expect(events[2]).toEqual({ kind: 'ASSISTANT_TEXT_DELTA', text: 'hello' });
    });

    it('should preserve event order', async () => {
      const emitter = createSessionEventEmitter();
      const events: unknown[] = [];

      const iterator = emitter.iterator();

      setTimeout(() => {
        emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
        emitter.emit({ kind: 'TOOL_CALL_START', toolCallId: 'call1', toolName: 'read', args: {} });
        emitter.emit({
          kind: 'TOOL_CALL_END',
          toolCallId: 'call1',
          toolName: 'read',
          output: 'result',
          isError: false,
        });
        emitter.emit({ kind: 'SESSION_END', sessionId: '1' });
        emitter.complete();
      }, 10);

      for await (const event of iterator) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: '1' });
      expect(events[3]).toEqual({ kind: 'SESSION_END', sessionId: '1' });
    });
  });

  describe('buffering', () => {
    it('should buffer events emitted before consumer starts', async () => {
      const emitter = createSessionEventEmitter();

      emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
      emitter.emit({ kind: 'ASSISTANT_TEXT_START' });
      emitter.complete();

      const events: unknown[] = [];
      for await (const event of emitter.iterator()) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: '1' });
      expect(events[1]).toEqual({ kind: 'ASSISTANT_TEXT_START' });
    });

    it('should deliver multiple buffered events in order', async () => {
      const emitter = createSessionEventEmitter();

      for (let i = 0; i < 5; i++) {
        emitter.emit({ kind: 'ASSISTANT_TEXT_DELTA', text: `chunk${i}` });
      }
      emitter.complete();

      const events: unknown[] = [];
      for await (const event of emitter.iterator()) {
        events.push(event);
      }

      expect(events).toHaveLength(5);
      events.forEach((e, i) => {
        expect((e as any).text).toBe(`chunk${i}`);
      });
    });
  });

  describe('backpressure', () => {
    it('should deliver events to waiting consumer', async () => {
      const emitter = createSessionEventEmitter();
      const events: unknown[] = [];

      const iterator = emitter.iterator();

      const consumerPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
        }
      })();

      // Consumer is waiting
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Emit while consumer is waiting
      emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
      await new Promise((resolve) => setTimeout(resolve, 20));

      emitter.emit({ kind: 'ASSISTANT_TEXT_START' });
      await new Promise((resolve) => setTimeout(resolve, 20));

      emitter.complete();
      await consumerPromise;

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: '1' });
      expect(events[1]).toEqual({ kind: 'ASSISTANT_TEXT_START' });
    });
  });

  describe('completion', () => {
    it('should terminate iterator when complete() is called', async () => {
      const emitter = createSessionEventEmitter();
      const events: unknown[] = [];

      emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
      emitter.complete();

      for await (const event of emitter.iterator()) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
    });

    it('should resolve waiting consumer when complete() called', async () => {
      const emitter = createSessionEventEmitter();
      const events: unknown[] = [];

      const iterator = emitter.iterator();

      const consumerPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
        }
      })();

      // Consumer is waiting
      await new Promise((resolve) => setTimeout(resolve, 20));

      emitter.complete();
      await consumerPromise;

      expect(events).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should throw error when error() called before consumer starts', async () => {
      const emitter = createSessionEventEmitter();
      const testError = new Error('Test error');

      emitter.error(testError);

      const iterator = emitter.iterator();

      let thrownError: Error | null = null;
      try {
        for await (const _ of iterator) {
          // Should not reach here
        }
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).toBe(testError);
    });

    it('should throw error to waiting consumer', async () => {
      const emitter = createSessionEventEmitter();
      const testError = new Error('Consumer error');

      const iterator = emitter.iterator();

      let thrownError: Error | null = null;
      const consumerPromise = (async () => {
        try {
          for await (const _ of iterator) {
            // Should not reach here
          }
        } catch (e) {
          thrownError = e as Error;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 20));
      emitter.error(testError);
      await consumerPromise;

      expect(thrownError).toBe(testError);
    });

    it('should throw on first next() call after buffered events', async () => {
      const emitter = createSessionEventEmitter();
      const testError = new Error('Deferred error');

      emitter.emit({ kind: 'SESSION_START', sessionId: '1' });
      emitter.error(testError);

      const iterator = emitter.iterator();
      const events: unknown[] = [];

      let thrownError: Error | null = null;
      try {
        for await (const event of iterator) {
          events.push(event);
        }
      } catch (e) {
        thrownError = e as Error;
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: '1' });
      expect(thrownError).toBe(testError);
    });
  });
});
