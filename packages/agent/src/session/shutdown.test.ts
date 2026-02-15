import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, StreamEvent } from '@attractor/llm';
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
} from '../types/index.js';
import { createSession } from './session.js';

function createMockProfile(): ProviderProfile {
  const toolRegistry = {
    get: () => null,
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
    readFile: async (path: string) => `content of ${path}`,
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

function createMockClient(
  responses: Array<Array<StreamEvent>>,
  shouldDelay: boolean = false,
): Client {
  let callIndex = 0;

  return {
    stream: async function* (/* request */) {
      if (callIndex < responses.length) {
        const events = responses[callIndex]!;
        callIndex++;
        for (const event of events) {
          if (shouldDelay) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          yield event;
        }
      }
    },
    complete: async () => {},
  } as any;
}

const mockResponseEvents: Array<StreamEvent> = [
  { type: 'STREAM_START' as const, id: 'test-1', model: 'gpt-4' },
  { type: 'TEXT_DELTA' as const, text: 'Hello' },
  { type: 'TEXT_DELTA' as const, text: ' world' },
  {
    type: 'FINISH' as const,
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
];

describe('Session Graceful Shutdown (AC11.5)', () => {
  describe('abort during streaming', () => {
    it('should emit SESSION_END event when abort called during streaming', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents], true);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const events: Array<any> = [];
      const eventIterator = session.events()[Symbol.asyncIterator]();

      const collectTask = (async () => {
        try {
          while (true) {
            const result = await eventIterator.next();
            if (result.done) break;
            events.push(result.value);
          }
        } catch (err) {
          // Stream ended
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const submitTask = session.submit('Create a file');

      await new Promise((resolve) => setTimeout(resolve, 150));

      await session.abort();

      await Promise.all([collectTask, submitTask]);

      const sessionEndEvents = events.filter((e) => e.kind === 'SESSION_END');
      expect(sessionEndEvents).toHaveLength(1);
      expect(sessionEndEvents[0]).toHaveProperty('sessionId');
    });

    it('should transition state to CLOSED when abort called', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      expect(session.state()).toBe('IDLE');

      const submitTask = session.submit('Test');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await session.abort();

      expect(session.state()).toBe('CLOSED');

      await submitTask;
    });

    it('should complete event iterator when abort called', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents], true);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      let iteratorCompleted = false;
      const eventIterator = session.events()[Symbol.asyncIterator]();

      const consumeTask = (async () => {
        try {
          while (true) {
            const result = await eventIterator.next();
            if (result.done) {
              iteratorCompleted = true;
              break;
            }
          }
        } catch (err) {
          // Error during iteration
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const submitTask = session.submit('Test');

      await new Promise((resolve) => setTimeout(resolve, 150));

      await session.abort();

      await Promise.all([consumeTask, submitTask]);

      expect(iteratorCompleted).toBe(true);
    });
  });

  describe('abort idempotency', () => {
    it('should be idempotent (calling abort twice does not crash)', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      await session.abort();
      await expect(session.abort()).resolves.not.toThrow();
    });

    it('should not emit SESSION_END multiple times on repeated aborts', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      const events: Array<any> = [];
      const eventIterator = session.events()[Symbol.asyncIterator]();

      const collectTask = (async () => {
        try {
          while (true) {
            const result = await eventIterator.next();
            if (result.done) break;
            events.push(result.value);
          }
        } catch (err) {
          // Completed
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 50));

      await session.abort();
      await session.abort();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await collectTask;

      const sessionEndEvents = events.filter((e) => e.kind === 'SESSION_END');
      expect(sessionEndEvents).toHaveLength(1);
    });
  });

  describe('state management', () => {
    it('should prevent submit after abort', async () => {
      const mockProfile = createMockProfile();
      const mockEnv = createMockEnvironment();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const mockClient = createMockClient([mockResponseEvents]);

      const session = createSession({
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
      });

      await session.abort();

      await expect(session.submit('Another message')).rejects.toThrow('Session is closed');
    });
  });
});
