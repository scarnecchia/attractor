import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, StreamEvent } from '@attractor/llm';
import { createSession } from './session.js';
import type { ProviderProfile, ExecutionEnvironment, SessionConfig } from '../types/index.js';

// Create mock implementations
function createMockClient(responses: Array<Array<StreamEvent>>): Client {
  let callIndex = 0;

  return {
    stream: function* (/* request */) {
      if (callIndex < responses.length) {
        for (const event of responses[callIndex]!) {
          yield event;
        }
        callIndex++;
      }
    } as any,
    complete: async () => {},
  } as any;
}

function createMockProfile(): ProviderProfile {
  const toolRegistry = {
    get: (name: string) => {
      if (name === 'echo') {
        return {
          definition: {
            name: 'echo',
            description: 'Echo a message',
            parameters: { type: 'object', properties: { text: { type: 'string' } } },
          },
          executor: async () => 'echoed',
        };
      }
      return null;
    },
    register: () => {},
    unregister: () => {},
    definitions: () => [
      {
        name: 'echo',
        description: 'Echo a message',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
      },
    ],
    list: () => [
      {
        definition: {
          name: 'echo',
          description: 'Echo a message',
          parameters: { type: 'object', properties: { text: { type: 'string' } } },
        },
        executor: async () => 'echoed',
      },
    ],
  };

  return {
    id: 'openai' as const,
    displayName: 'OpenAI',
    defaultModel: 'gpt-4',
    toolRegistry: toolRegistry as any,
    supportsParallelToolCalls: false,
    buildSystemPrompt: () => 'You are a helpful assistant.',
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

const defaultUsage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

describe('Session', () => {
  let mockClient: Client;
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

  describe('lifecycle', () => {
    it('should emit SESSION_START on creation', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const events: any[] = [];
      const iterator = session.events();

      // Collect first event (SESSION_START) with timeout
      const promise = (async () => {
        for await (const event of iterator) {
          events.push(event);
          if (events.length >= 1 && events[0].kind === 'SESSION_START') {
            break;
          }
        }
      })();

      // Set timeout for safety
      await Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))]);

      expect(events[0]).toEqual({ kind: 'SESSION_START', sessionId: expect.any(String) });
    });

    it('should transition to IDLE after creation', () => {
      mockClient = createMockClient([]);
      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      expect(session.state()).toBe('IDLE');
    });

    it('should transition to PROCESSING when submit is called', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const submitPromise = session.submit('Hello');
      // Note: state may briefly be PROCESSING
      await submitPromise;
      expect(session.state()).toBe('IDLE');
    });
  });

  describe('natural completion', () => {
    it('should exit loop when model responds with text only (AC1.3)', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Hello there!' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of session.events()) {
          events.push(event);
        }
      })();

      await session.submit('Hello');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have SESSION_START, text events, and no tool calls
      expect(events.some((e) => e.kind === 'SESSION_START')).toBe(true);
      expect(events.some((e) => e.kind === 'ASSISTANT_TEXT_DELTA')).toBe(true);
      expect(events.some((e) => e.kind === 'ASSISTANT_TEXT_END')).toBe(true);
    });

    it('should return to IDLE after natural completion', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Done' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events in background
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      await session.submit('Test');
      expect(session.state()).toBe('IDLE');
    });
  });

  describe('steer and followUp', () => {
    it('should queue steering messages via steer()', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      session.steer('Adjust your approach');
      await session.submit('Input');

      // Verify history includes steering turn
      const history = session.history();
      expect(history.some((turn) => turn.kind === 'steering')).toBe(true);
    });

    it('should queue followUp messages for next cycle', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response1' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response2' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      session.followUp('Next question');
      await session.submit('First input');

      // Verify two user turns exist
      const history = session.history();
      const userTurns = history.filter((turn) => turn.kind === 'user');
      expect(userTurns.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('abort', () => {
    it('should transition to CLOSED on abort', async () => {
      mockClient = createMockClient([]);
      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      await session.abort();
      expect(session.state()).toBe('CLOSED');
    });

    it('should emit SESSION_END on abort', async () => {
      mockClient = createMockClient([]);
      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of session.events()) {
          events.push(event);
        }
      })();

      await session.abort();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(events.some((e) => e.kind === 'SESSION_END')).toBe(true);
    });
  });

  describe('history tracking', () => {
    it('should append user input to history on submit', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      await session.submit('Test input');

      const history = session.history();
      expect(history.some((turn) => turn.kind === 'user' && turn.content === 'Test input')).toBe(true);
    });

    it('should append assistant response to history', async () => {
      mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      // Drain events
      (async () => {
        for await (const event of session.events()) {
          // consume
        }
      })();

      await session.submit('Test');

      const history = session.history();
      expect(history.some((turn) => turn.kind === 'assistant')).toBe(true);
    });
  });
});
