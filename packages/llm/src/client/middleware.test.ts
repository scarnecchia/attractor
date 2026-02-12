import { describe, it, expect, vi } from 'vitest';
import type { Middleware, LLMRequest, LLMResponse, StreamEvent } from '../types/index.js';
import { emptyUsage } from '../types/response.js';
import { executeMiddlewareChain } from './middleware.js';

describe('executeMiddlewareChain', () => {
  const mockRequest: LLMRequest = {
    model: 'test-model',
    prompt: 'test prompt',
  };

  const mockResponse: LLMResponse = {
    id: 'test-id',
    model: 'test-model',
    content: [],
    finishReason: 'stop',
    usage: emptyUsage(),
    rateLimitInfo: null,
    warnings: [],
    steps: [],
    providerMetadata: {},
  };

  describe('request-response flow', () => {
    it('AC2.1: executes two middleware in request-phase order (first to last)', async () => {
      const log: string[] = [];

      const mw1: Middleware = (request, next) => {
        log.push('mw1-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw1-after');
            return res;
          });
        }
        return result;
      };

      const mw2: Middleware = (request, next) => {
        log.push('mw2-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw2-after');
            return res;
          });
        }
        return result;
      };

      const handler = (): Promise<LLMResponse> => {
        log.push('handler');
        return Promise.resolve(mockResponse);
      };

      const result = executeMiddlewareChain([mw1, mw2], mockRequest, handler);
      const awaitedResult = await (result instanceof Promise ? result : Promise.reject(new Error('Expected Promise')));

      expect(log).toEqual([
        'mw1-before',
        'mw2-before',
        'handler',
        'mw2-after',
        'mw1-after',
      ]);
      expect(awaitedResult).toEqual(mockResponse);
    });

    it('AC2.2: executes two middleware in response-phase order (last to first)', async () => {
      const log: string[] = [];

      const mw1: Middleware = (request, next) => {
        log.push('mw1-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw1-after');
            return res;
          });
        }
        return result;
      };

      const mw2: Middleware = (request, next) => {
        log.push('mw2-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw2-after');
            return res;
          });
        }
        return result;
      };

      const handler = (): Promise<LLMResponse> => {
        log.push('handler');
        return Promise.resolve(mockResponse);
      };

      const result = executeMiddlewareChain([mw1, mw2], mockRequest, handler);
      if (result instanceof Promise) {
        await result;
      }

      // Response phase should be mw2-after, then mw1-after (reverse of registration)
      const responsePhaseStart = log.indexOf('handler') + 1;
      const responsePhase = log.slice(responsePhaseStart);
      expect(responsePhase).toEqual(['mw2-after', 'mw1-after']);
    });

    it('AC2.4: three middleware compose correctly in full onion order', async () => {
      const log: string[] = [];

      const mw1: Middleware = (request, next) => {
        log.push('mw1-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw1-after');
            return res;
          });
        }
        return result;
      };

      const mw2: Middleware = (request, next) => {
        log.push('mw2-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw2-after');
            return res;
          });
        }
        return result;
      };

      const mw3: Middleware = (request, next) => {
        log.push('mw3-before');
        const result = next(request);
        if (result instanceof Promise) {
          return result.then((res) => {
            log.push('mw3-after');
            return res;
          });
        }
        return result;
      };

      const handler = (): Promise<LLMResponse> => {
        log.push('handler');
        return Promise.resolve(mockResponse);
      };

      const result = executeMiddlewareChain([mw1, mw2, mw3], mockRequest, handler);
      if (result instanceof Promise) {
        await result;
      }

      expect(log).toEqual([
        'mw1-before',
        'mw2-before',
        'mw3-before',
        'handler',
        'mw3-after',
        'mw2-after',
        'mw1-after',
      ]);
    });

    it('can modify request before calling next', async () => {
      const capturedRequests: LLMRequest[] = [];

      const mw: Middleware = (request, next) => {
        const modifiedRequest: LLMRequest = {
          ...request,
          providerOptions: {
            ...request.providerOptions,
            test: { headerValue: 'added' },
          },
        };
        return next(modifiedRequest);
      };

      const handler = (request: LLMRequest): Promise<LLMResponse> => {
        capturedRequests.push(request);
        return Promise.resolve(mockResponse);
      };

      const result = executeMiddlewareChain([mw], mockRequest, handler);
      if (result instanceof Promise) {
        await result;
      }

      expect(capturedRequests).toHaveLength(1);
      const received = capturedRequests[0];
      expect(received).toBeDefined();
      if (received && received.providerOptions) {
        expect(received.providerOptions['test']).toEqual({ headerValue: 'added' });
      }
    });

    it('works with no middleware', async () => {
      const handlerSpy = vi.fn().mockResolvedValue(mockResponse);

      const result = await executeMiddlewareChain([], mockRequest, handlerSpy);

      expect(handlerSpy).toHaveBeenCalledWith(mockRequest);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('streaming flow', () => {
    function isAsyncIterable(value: unknown): value is AsyncIterable<StreamEvent> {
      return (
        typeof value === 'object' &&
        value !== null &&
        Symbol.asyncIterator in value
      );
    }

    async function* mockStreamHandler(): AsyncIterable<StreamEvent> {
      yield {
        type: 'STREAM_START',
        id: 'test-id',
        model: 'test-model',
      };
      yield {
        type: 'TEXT_DELTA',
        text: 'hello ',
      };
      yield {
        type: 'TEXT_DELTA',
        text: 'world',
      };
      yield {
        type: 'FINISH',
        finishReason: 'stop',
        usage: emptyUsage(),
      };
    }

    it('AC2.3: middleware wrapping streaming calls can observe and transform events', async () => {
      const log: StreamEvent[] = [];

      const mw: Middleware = (request, next) => {
        const iterable = next(request);
        return (async function* () {
          if (isAsyncIterable(iterable)) {
            for await (const event of iterable) {
              log.push(event);
              yield event;
            }
          }
        })();
      };

      const events: StreamEvent[] = [];
      const result = executeMiddlewareChain([mw], mockRequest, mockStreamHandler);

      if (isAsyncIterable(result)) {
        for await (const event of result) {
          events.push(event);
        }
      }

      expect(log).toHaveLength(4);
      expect(log[0]?.type).toBe('STREAM_START');
      expect(log[1]?.type).toBe('TEXT_DELTA');
      expect(events).toHaveLength(4);
    });

    it('multiple middleware can wrap streaming', async () => {
      const mw1Log: StreamEvent[] = [];
      const mw2Log: StreamEvent[] = [];

      const mw1: Middleware = (request, next) => {
        const iterable = next(request);
        return (async function* () {
          if (isAsyncIterable(iterable)) {
            for await (const event of iterable) {
              mw1Log.push(event);
              yield event;
            }
          }
        })();
      };

      const mw2: Middleware = (request, next) => {
        const iterable = next(request);
        return (async function* () {
          if (isAsyncIterable(iterable)) {
            for await (const event of iterable) {
              mw2Log.push(event);
              yield event;
            }
          }
        })();
      };

      const events: StreamEvent[] = [];
      const result = executeMiddlewareChain([mw1, mw2], mockRequest, mockStreamHandler);

      if (isAsyncIterable(result)) {
        for await (const event of result) {
          events.push(event);
        }
      }

      expect(mw1Log).toHaveLength(4);
      expect(mw2Log).toHaveLength(4);
      expect(events).toHaveLength(4);
    });
  });
});
