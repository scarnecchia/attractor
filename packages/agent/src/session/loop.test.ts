import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, StreamEvent, ToolCall } from '@attractor/llm';
import type { LoopContext } from './session.js';
import { processInput } from './loop.js';
import { createSessionEventEmitter } from './events.js';
import { createSteeringQueue } from './steering.js';
import { createLoopDetector } from './loop-detection.js';
import { createContextTracker } from './context-tracking.js';
import type { ProviderProfile, ExecutionEnvironment, SessionConfig } from '../types/index.js';

const defaultUsage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function createMockProfile(): ProviderProfile {
  const toolRegistry = {
    get: (name: string) => {
      if (name === 'read_file') {
        return {
          definition: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          executor: async (args: Record<string, unknown>) => `content of ${args['path']}`,
        };
      }
      return null;
    },
    register: () => {},
    unregister: () => {},
    definitions: () => [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ],
    list: () => [
      {
        definition: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
        executor: async (args: Record<string, unknown>) => `content of ${args['path']}`,
      },
    ],
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

describe('processInput', () => {
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

  describe('text-only responses', () => {
    it('should exit loop on text-only response (AC1.3)', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Hello' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter: createSessionEventEmitter(),
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      await processInput(context);

      // History should have user + assistant turns
      expect(context.history.length).toBe(2);
      expect(context.history[1]!.kind).toBe('assistant');
    });

    it('should emit ASSISTANT_TEXT_START and ASSISTANT_TEXT_END', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
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

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      expect(events.some((e) => e.kind === 'ASSISTANT_TEXT_START')).toBe(true);
      expect(events.some((e) => e.kind === 'ASSISTANT_TEXT_END')).toBe(true);
    });
  });

  describe('tool execution', () => {
    it('should emit TOOL_CALL_START and TOOL_CALL_END events', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'call1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: '{"path":' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: '"/test.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'call1' },
          { type: 'TEXT_DELTA', text: 'File contents' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Done' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Read test.txt' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      expect(events.some((e) => e.kind === 'TOOL_CALL_START' && e.toolName === 'read_file')).toBe(true);
      expect(events.some((e) => e.kind === 'TOOL_CALL_END' && e.toolName === 'read_file')).toBe(true);
    });

    it('should execute multiple tool calls sequentially', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'call1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: '{"path":"/file1.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'call1' },
          { type: 'TOOL_CALL_START', toolCallId: 'call2', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call2', argsDelta: '{"path":"/file2.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'call2' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Done' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Read two files' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      const toolEndEvents = events.filter((e) => e.kind === 'TOOL_CALL_END');
      expect(toolEndEvents.length).toBe(2);
    });

    it('should append ToolResultsTurn after executing tools', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'call1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: '{"path":"/test.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'call1' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'File read' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
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

      await processInput(context);

      // History should be: user, assistant (with tool call), tool_results, assistant (final)
      expect(context.history.length).toBe(4);
      expect(context.history[2]!.kind).toBe('tool_results');
    });
  });

  describe('max_tool_rounds_per_input', () => {
    it('should emit TURN_LIMIT when max_tool_rounds exceeded (AC1.5)', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c1', argsDelta: '{"path":"/1.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c1' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c2', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c2', argsDelta: '{"path":"/2.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c2' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg3', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c3', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c3', argsDelta: '{"path":"/3.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c3' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const testConfig: SessionConfig = { ...config, maxToolRoundsPerInput: 2 };

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config: testConfig,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      expect(events.some((e) => e.kind === 'TURN_LIMIT' && e.reason === 'max_tool_rounds')).toBe(true);
    });
  });

  describe('max_turns', () => {
    it('should emit TURN_LIMIT when max_turns exceeded (AC1.6)', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c1', argsDelta: '{"path":"/1.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c1' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c2', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c2', argsDelta: '{"path":"/2.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c2' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg3', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'c3', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'c3', argsDelta: '{"path":"/3.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c3' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const testConfig: SessionConfig = { ...config, maxTurns: 2 };

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config: testConfig,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue: createSteeringQueue(),
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      expect(events.some((e) => e.kind === 'TURN_LIMIT' && e.reason === 'max_turns')).toBe(true);
    });
  });

  describe('steering injection', () => {
    it('should drain steering queue before LLM call', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const steeringQueue = createSteeringQueue();
      steeringQueue.steer('Adjust approach');

      const context: LoopContext = {
        sessionId: 'test-session',
        profile: mockProfile,
        environment: mockEnv,
        client: mockClient,
        config,
        history: [{ kind: 'user', content: 'Test' }],
        eventEmitter,
        steeringQueue,
        loopDetector: createLoopDetector(),
        contextTracker: createContextTracker(undefined),
        abortController: new AbortController(),
      };

      await processInput(context);

      // History should include steering turn
      expect(context.history.some((turn) => turn.kind === 'steering')).toBe(true);
    });
  });

  describe('abort signal', () => {
    it('should stop processing on abort (AC1.7)', async () => {
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Response' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const abortController = new AbortController();

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
        abortController,
      };

      // Abort before processing
      abortController.abort();

      const events: any[] = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      expect(events.some((e) => e.kind === 'SESSION_END')).toBe(true);
    });
  });
});
