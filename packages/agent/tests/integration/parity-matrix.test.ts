import { describe, test, expect } from 'vitest';
import type { Client, StreamEvent } from '@attractor/llm';
import { createOpenAIProfile } from '../../src/profiles/openai/index.js';
import { createAnthropicProfile } from '../../src/profiles/anthropic/index.js';
import { createGeminiProfile } from '../../src/profiles/gemini/index.js';
import { createSessionEventEmitter } from '../../src/session/events.js';
import { createSteeringQueue } from '../../src/session/steering.js';
import { createLoopDetector } from '../../src/session/loop-detection.js';
import { createContextTracker } from '../../src/session/context-tracking.js';
import { processInput } from '../../src/session/loop.js';
import type { LoopContext } from '../../src/session/index.js';
import type { ExecutionEnvironment, SessionConfig } from '../../src/types/index.js';

const PROFILES = [
  { name: 'openai', create: createOpenAIProfile },
  { name: 'anthropic', create: createAnthropicProfile },
  { name: 'gemini', create: createGeminiProfile },
] as const;

const defaultUsage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

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

describe('Cross-Provider Parity Matrix', () => {
  describe.each(PROFILES)('$name profile', ({ name, create }) => {
    test('1. Tool definitions include required tools', () => {
      const profile = create();
      const toolDefs = profile.toolRegistry.definitions();
      const toolNames = toolDefs.map((t) => t.name);

      // All profiles have these tools
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('shell');
      expect(toolNames).toContain('grep');
      expect(toolNames).toContain('glob');

      if (name === 'openai') {
        expect(toolNames).toContain('apply_patch');
        expect(toolNames).not.toContain('edit_file');
      } else if (name === 'anthropic') {
        expect(toolNames).toContain('edit_file');
        expect(toolNames).not.toContain('apply_patch');
      } else if (name === 'gemini') {
        expect(toolNames).toContain('edit_file');
        expect(toolNames).toContain('list_dir');
        expect(toolNames).not.toContain('apply_patch');
      }
    });

    test('2. System prompt is non-empty', () => {
      const profile = create();
      const context = {
        platform: 'linux',
        osVersion: '5.10.0',
        workingDirectory: '/tmp',
        gitBranch: null,
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'gpt-4',
        projectDocs: '',
        userInstruction: null,
      };
      const systemPrompt = profile.buildSystemPrompt(context);

      expect(systemPrompt).toBeTruthy();
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(typeof systemPrompt).toBe('string');
    });

    test('3. Capability flags are set correctly', () => {
      const profile = create();

      expect(typeof profile.supportsParallelToolCalls).toBe('boolean');
      expect(profile.defaultCommandTimeout).toBeGreaterThan(0);
      expect(profile.defaultModel).toBeTruthy();
    });

    test('4. Agentic loop simulation with read_file tool call', async () => {
      const profile = create();
      const mockEnv = createMockEnvironment();

      // Mock responses: first with read_file tool call, then text-only
      const mockClient = createMockClient([
        [
          { type: 'STREAM_START', id: 'msg1', model: 'gpt-4' },
          { type: 'TOOL_CALL_START', toolCallId: 'call1', toolName: 'read_file' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: '{"' },
          { type: 'TOOL_CALL_DELTA', toolCallId: 'call1', argsDelta: 'path":"test.txt"}' },
          { type: 'TOOL_CALL_END', toolCallId: 'call1' },
          { type: 'FINISH', finishReason: 'tool_calls', usage: defaultUsage },
        ],
        [
          { type: 'STREAM_START', id: 'msg2', model: 'gpt-4' },
          { type: 'TEXT_DELTA', text: 'Done' },
          { type: 'FINISH', finishReason: 'stop', usage: defaultUsage },
        ],
      ]);

      const eventEmitter = createSessionEventEmitter();
      const config: SessionConfig = {
        model: 'gpt-4',
        provider: 'openai' as any,
        maxToolRoundsPerInput: 5,
        maxTurns: 20,
      };

      const context: LoopContext = {
        sessionId: `test-${name}`,
        profile,
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

      const events: Array<any> = [];
      const collectPromise = (async () => {
        for await (const event of eventEmitter.iterator()) {
          events.push(event);
        }
      })();

      await processInput(context);
      eventEmitter.complete();
      await collectPromise;

      // Verify tool execution events were emitted
      expect(events.some((e) => e.kind === 'TOOL_CALL_START' && e.toolName === 'read_file')).toBe(true);
      expect(events.some((e) => e.kind === 'TOOL_CALL_END' && e.toolName === 'read_file')).toBe(true);

      // Verify history: user + assistant + toolresults + assistant
      expect(context.history.length).toBeGreaterThanOrEqual(3);
    });

    test('5. Tool executor is callable for read_file', async () => {
      const profile = create();
      const tool = profile.toolRegistry.get('read_file');

      expect(tool).toBeDefined();
      expect(tool?.definition).toBeDefined();
      expect(tool?.executor).toBeDefined();

      // Try executing with mock environment
      const mockEnv = createMockEnvironment();
      const result = await tool?.executor(
        { file_path: 'test.txt' },
        mockEnv
      );
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    test('6. All tools in profile are registered', () => {
      const profile = create();
      const tools = profile.toolRegistry.list();

      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.definition).toBeDefined();
        expect(tool.definition.name).toBeTruthy();
        expect(tool.executor).toBeDefined();
      }
    });
  });
});
