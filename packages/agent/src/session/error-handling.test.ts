import { describe, it, expect, beforeEach } from 'vitest';
import type { Client, StreamEvent } from '@attractor/llm';
import {
  AuthenticationError,
  ContextLengthError,
  ProviderError,
  RateLimitError,
} from '@attractor/llm';
import type { LoopContext } from './session.js';
import { processInput } from './loop.js';
import { createSessionEventEmitter } from './events.js';
import { createSteeringQueue } from './steering.js';
import { createLoopDetector } from './loop-detection.js';
import { createContextTracker } from './context-tracking.js';
import type { ProviderProfile, ExecutionEnvironment, SessionConfig } from '../types/index.js';

function createMockProfile(): ProviderProfile {
  const toolRegistry = {
    get: (name: string) => {
      if (name === 'test_tool') {
        return {
          definition: {
            name: 'test_tool',
            description: 'Test tool',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          executor: async () => 'tool executed',
        };
      }
      return null;
    },
    register: () => {},
    unregister: () => {},
    definitions: () => [],
    list: () => [],
  };

  return {
    id: 'openai' as const,
    displayName: 'OpenAI',
    defaultModel: 'gpt-4',
    toolRegistry: toolRegistry as any,
    supportsParallelToolCalls: false,
    buildSystemPrompt: () => 'You are helpful.',
    projectDocFiles: [],
    defaultCommandTimeout: 5000,
  };
}

function createMockEnvironment(): ExecutionEnvironment {
  return {
    readFile: async () => 'content',
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => true,
    listDirectory: async () => [],
    execCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 }),
    grep: async () => '',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'linux',
    osVersion: () => '5.10.0',
  };
}

describe('Error Handling in Agentic Loop', () => {
  let mockProfile: ProviderProfile;
  let mockEnv: ExecutionEnvironment;
  let config: SessionConfig;

  beforeEach(() => {
    mockProfile = createMockProfile();
    mockEnv = createMockEnvironment();
    config = {
      model: 'gpt-4',
      provider: 'openai',
      maxToolRoundsPerInput: 5,
      maxTurns: 20,
    };
  });

  describe('AC11.2: AuthenticationError handling', () => {
    it('should emit ERROR event and throw when AuthenticationError is thrown', async () => {
      const mockClient: Client = {
        stream: async function* () {
          throw new AuthenticationError(
            'Invalid API key',
            401,
            'openai',
            'invalid_api_key'
          );
        },
        complete: async () => ({ content: [], finishReason: 'stop' }),
      } as any;

      const eventEmitter = createSessionEventEmitter();
      const events: Array<any> = [];

      // Collect events from iterator
      const iterator = eventEmitter.iterator();
      const collectEventsPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (event.kind === 'ERROR') {
            break;
          }
        }
      })();

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      // processInput should throw after emitting ERROR event
      await expect(processInput(context)).rejects.toThrow(AuthenticationError);

      // Emit SESSION_END to complete iterator
      eventEmitter.emit({ kind: 'SESSION_END', sessionId: 'test-session' });
      eventEmitter.complete();

      await collectEventsPromise;

      // Check that ERROR event was emitted
      const errorEvent = events.find((e) => e.kind === 'ERROR');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeInstanceOf(AuthenticationError);
      expect(errorEvent?.error?.message).toBe('Invalid API key');
    });
  });

  describe('AC11.3: ContextLengthError handling', () => {
    it('should emit CONTEXT_WARNING and ERROR events when ContextLengthError is thrown', async () => {
      const mockClient: Client = {
        stream: async function* () {
          throw new ContextLengthError(
            'Context length exceeded',
            400,
            'openai',
            'context_length_exceeded'
          );
        },
        complete: async () => ({ content: [], finishReason: 'stop' }),
      } as any;

      const eventEmitter = createSessionEventEmitter();
      const events: Array<any> = [];

      // Collect events from iterator
      const iterator = eventEmitter.iterator();
      const collectEventsPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (event.kind === 'ERROR') {
            break;
          }
        }
      })();

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      // processInput should throw after emitting events
      await expect(processInput(context)).rejects.toThrow(ContextLengthError);

      // Emit SESSION_END to complete iterator
      eventEmitter.emit({ kind: 'SESSION_END', sessionId: 'test-session' });
      eventEmitter.complete();

      await collectEventsPromise;

      // Check that CONTEXT_WARNING was emitted with 100% usage
      const warningEvent = events.find((e) => e.kind === 'CONTEXT_WARNING');
      expect(warningEvent).toBeDefined();
      expect(warningEvent?.usagePercent).toBe(1.0);

      // Check that ERROR event was also emitted
      const errorEvent = events.find((e) => e.kind === 'ERROR');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeInstanceOf(ContextLengthError);
    });
  });

  describe('AC11.4: Retryable ProviderError handling', () => {
    it('should emit ERROR event when retryable RateLimitError surfaces past retry layer', async () => {
      const mockClient: Client = {
        stream: async function* () {
          throw new RateLimitError(
            'Rate limit exceeded',
            429,
            'openai',
            'rate_limit_exceeded',
            null,
            60
          );
        },
        complete: async () => ({ content: [], finishReason: 'stop' }),
      } as any;

      const eventEmitter = createSessionEventEmitter();
      const events: Array<any> = [];

      // Collect events from iterator
      const iterator = eventEmitter.iterator();
      const collectEventsPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (event.kind === 'ERROR') {
            break;
          }
        }
      })();

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      // processInput should throw after emitting ERROR event
      await expect(processInput(context)).rejects.toThrow(RateLimitError);

      // Emit SESSION_END to complete iterator
      eventEmitter.emit({ kind: 'SESSION_END', sessionId: 'test-session' });
      eventEmitter.complete();

      await collectEventsPromise;

      // Check that ERROR event was emitted for retryable error
      const errorEvent = events.find((e) => e.kind === 'ERROR');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeInstanceOf(RateLimitError);
    });
  });

  describe('Unknown error handling', () => {
    it('should emit ERROR event for unknown error types', async () => {
      const mockClient: Client = {
        stream: async function* () {
          throw new TypeError('Something went wrong');
        },
        complete: async () => ({ content: [], finishReason: 'stop' }),
      } as any;

      const eventEmitter = createSessionEventEmitter();
      const events: Array<any> = [];

      // Collect events from iterator
      const iterator = eventEmitter.iterator();
      const collectEventsPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (event.kind === 'ERROR') {
            break;
          }
        }
      })();

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      // processInput should throw after emitting ERROR event
      await expect(processInput(context)).rejects.toThrow(TypeError);

      // Emit SESSION_END to complete iterator
      eventEmitter.emit({ kind: 'SESSION_END', sessionId: 'test-session' });
      eventEmitter.complete();

      await collectEventsPromise;

      // Check that ERROR event was emitted
      const errorEvent = events.find((e) => e.kind === 'ERROR');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeInstanceOf(Error);
      expect(errorEvent?.error?.message).toBe('Something went wrong');
    });

    it('should convert non-Error thrown values to Error objects', async () => {
      const mockClient: Client = {
        stream: async function* () {
          throw 'string error'; // eslint-disable-line no-throw-literal
        },
        complete: async () => ({ content: [], finishReason: 'stop' }),
      } as any;

      const eventEmitter = createSessionEventEmitter();
      const events: Array<any> = [];

      // Collect events from iterator
      const iterator = eventEmitter.iterator();
      const collectEventsPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (event.kind === 'ERROR') {
            break;
          }
        }
      })();

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      // processInput should throw after emitting ERROR event
      await expect(processInput(context)).rejects.toThrow('string error');

      // Emit SESSION_END to complete iterator
      eventEmitter.emit({ kind: 'SESSION_END', sessionId: 'test-session' });
      eventEmitter.complete();

      await collectEventsPromise;

      // Check that ERROR event was emitted with Error object
      const errorEvent = events.find((e) => e.kind === 'ERROR');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeInstanceOf(Error);
      expect(errorEvent?.error?.message).toBe('string error');
    });
  });
});
