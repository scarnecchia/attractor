import { describe, it, expect } from 'vitest';
import { dispatchToolCalls, type PendingToolCall } from './dispatch.js';
import { createToolRegistry, type ToolRegistry, type ExecutionEnvironment } from '../types/index.js';

/**
 * Mock ExecutionEnvironment for testing
 */
function createMockEnv(): ExecutionEnvironment {
  return {
    readFile: async () => 'file content',
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => true,
    listDirectory: async () => [],
    execCommand: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 0,
    }),
    grep: async () => 'grep results',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
  };
}

describe('dispatchToolCalls', () => {
  describe('AC3.1: Successful execution', () => {
    it('should dispatch tool call through registry and receive output', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'echo',
            description: 'Echo tool',
            parameters: {},
          },
          executor: async (args) => {
            const message = args.message as string;
            return `Echo: ${message}`;
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'echo',
          args: { message: 'hello' },
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        toolCallId: 'call-1',
        output: 'Echo: hello',
        isError: false,
      });
    });

    it('executor receives correct args', async () => {
      let receivedArgs: Record<string, unknown> | null = null;

      const registry = createToolRegistry([
        {
          definition: {
            name: 'capture',
            description: 'Capture args',
            parameters: {},
          },
          executor: async (args) => {
            receivedArgs = args;
            return 'captured';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'capture',
          args: { file_path: '/tmp/test.txt', offset: 10, limit: 100 },
        },
      ];

      await dispatchToolCalls(toolCalls, registry, env, false);

      expect(receivedArgs).toEqual({
        file_path: '/tmp/test.txt',
        offset: 10,
        limit: 100,
      });
    });

    it('executor receives correct env', async () => {
      let receivedEnv: ExecutionEnvironment | null = null;

      const registry = createToolRegistry([
        {
          definition: {
            name: 'capture',
            description: 'Capture env',
            parameters: {},
          },
          executor: async (_args, env) => {
            receivedEnv = env;
            return 'captured';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'capture',
          args: {},
        },
      ];

      await dispatchToolCalls(toolCalls, registry, env, false);

      expect(receivedEnv).toBe(env);
    });
  });

  describe('AC3.2: Unknown tool name', () => {
    it('should return error result with descriptive message', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'known',
            description: 'Known tool',
            parameters: {},
          },
          executor: async () => 'output',
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'unknown_tool',
          args: {},
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].output).toContain('Unknown tool: unknown_tool');
      expect(results[0].output).toContain('known');
    });

    it('should list available tools in error message', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'tool1', description: '', parameters: {} },
          executor: async () => 'output',
        },
        {
          definition: { name: 'tool2', description: '', parameters: {} },
          executor: async () => 'output',
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'missing',
          args: {},
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].output).toContain('tool1');
      expect(results[0].output).toContain('tool2');
    });

    it('should not throw exception, return error result', async () => {
      const registry = createToolRegistry();
      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'nonexistent',
          args: {},
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
    });
  });

  describe('AC3.3: Invalid JSON arguments', () => {
    it('should return error result if args is not an object', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'tool',
            description: 'Tool',
            parameters: {},
          },
          executor: async (args) => {
            if (typeof args !== 'object' || args === null) {
              throw new Error('Invalid args');
            }
            return 'ok';
          },
        },
      ]);

      const env = createMockEnv();

      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'tool',
          args: null as any,
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].isError).toBe(true);
      expect(results[0].output).toContain('Invalid tool arguments');
    });

    it('should return error result if args is an array', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'tool',
            description: 'Tool',
            parameters: {},
          },
          executor: async () => 'ok',
        },
      ]);

      const env = createMockEnv();

      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'tool',
          args: [] as any,
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].isError).toBe(true);
    });
  });

  describe('AC3.4: Executor throws exception', () => {
    it('should catch exception and return error result', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'failing_tool',
            description: 'Tool that throws',
            parameters: {},
          },
          executor: async () => {
            throw new Error('Execution failed');
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'failing_tool',
          args: {},
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].output).toContain('Tool error in failing_tool');
      expect(results[0].output).toContain('Execution failed');
    });

    it('should handle non-Error exceptions', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'bad_tool',
            description: 'Tool that throws non-Error',
            parameters: {},
          },
          executor: async () => {
            throw 'string error';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'bad_tool',
          args: {},
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].isError).toBe(true);
      expect(results[0].output).toContain('string error');
    });

    it('should return error result, not throw', async () => {
      const registry = createToolRegistry([
        {
          definition: {
            name: 'tool',
            description: 'Tool',
            parameters: {},
          },
          executor: async () => {
            throw new Error('Boom');
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'tool',
          args: {},
        },
      ];

      await expect(dispatchToolCalls(toolCalls, registry, env, false)).resolves.toBeDefined();
    });
  });

  describe('AC3.5: Parallel execution', () => {
    it('should run multiple tools concurrently when parallel=true', async () => {
      const executionTimes: number[] = [];

      const registry = createToolRegistry([
        {
          definition: { name: 'tool1', description: '', parameters: {} },
          executor: async () => {
            const start = Date.now();
            await new Promise((resolve) => setTimeout(resolve, 50));
            executionTimes.push(Date.now() - start);
            return 'output1';
          },
        },
        {
          definition: { name: 'tool2', description: '', parameters: {} },
          executor: async () => {
            const start = Date.now();
            await new Promise((resolve) => setTimeout(resolve, 50));
            executionTimes.push(Date.now() - start);
            return 'output2';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'tool1', args: {} },
        { toolCallId: 'call-2', toolName: 'tool2', args: {} },
      ];

      const startTotal = Date.now();
      const results = await dispatchToolCalls(toolCalls, registry, env, true);
      const totalTime = Date.now() - startTotal;

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(false);

      expect(totalTime).toBeLessThan(150);
    });

    it('should run sequentially when parallel=false', async () => {
      const executionOrder: string[] = [];

      const registry = createToolRegistry([
        {
          definition: { name: 'tool1', description: '', parameters: {} },
          executor: async () => {
            executionOrder.push('tool1');
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'output1';
          },
        },
        {
          definition: { name: 'tool2', description: '', parameters: {} },
          executor: async () => {
            executionOrder.push('tool2');
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'output2';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'tool1', args: {} },
        { toolCallId: 'call-2', toolName: 'tool2', args: {} },
      ];

      const startTotal = Date.now();
      const results = await dispatchToolCalls(toolCalls, registry, env, false);
      const totalTime = Date.now() - startTotal;

      expect(results).toHaveLength(2);
      expect(executionOrder).toEqual(['tool1', 'tool2']);

      expect(totalTime).toBeGreaterThanOrEqual(100);
    });

    it('should handle errors in parallel execution', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'good_tool', description: '', parameters: {} },
          executor: async () => 'success',
        },
        {
          definition: { name: 'bad_tool', description: '', parameters: {} },
          executor: async () => {
            throw new Error('Failed');
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'good_tool', args: {} },
        { toolCallId: 'call-2', toolName: 'bad_tool', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, true);

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(true);
    });
  });

  describe('Multiple tool calls', () => {
    it('should dispatch multiple successful calls', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'tool1', description: '', parameters: {} },
          executor: async () => 'result1',
        },
        {
          definition: { name: 'tool2', description: '', parameters: {} },
          executor: async () => 'result2',
        },
        {
          definition: { name: 'tool3', description: '', parameters: {} },
          executor: async () => 'result3',
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'tool1', args: {} },
        { toolCallId: 'call-2', toolName: 'tool2', args: {} },
        { toolCallId: 'call-3', toolName: 'tool3', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results).toHaveLength(3);
      expect(results[0].output).toBe('result1');
      expect(results[1].output).toBe('result2');
      expect(results[2].output).toBe('result3');
    });

    it('should preserve tool call IDs in results', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'tool', description: '', parameters: {} },
          executor: async () => 'output',
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'abc-123', toolName: 'tool', args: {} },
        { toolCallId: 'xyz-789', toolName: 'tool', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].toolCallId).toBe('abc-123');
      expect(results[1].toolCallId).toBe('xyz-789');
    });

    it('should handle mixed success and failure', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'good', description: '', parameters: {} },
          executor: async () => 'success',
        },
        {
          definition: { name: 'bad', description: '', parameters: {} },
          executor: async () => {
            throw new Error('Error');
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'good', args: {} },
        { toolCallId: 'call-2', toolName: 'bad', args: {} },
        { toolCallId: 'call-3', toolName: 'good', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(true);
      expect(results[2].isError).toBe(false);
    });
  });

  describe('Empty tool calls', () => {
    it('should handle empty array of tool calls', async () => {
      const registry = createToolRegistry();
      const env = createMockEnv();
      const results = await dispatchToolCalls([], registry, env, false);

      expect(results).toEqual([]);
    });

    it('should handle empty array in parallel mode', async () => {
      const registry = createToolRegistry();
      const env = createMockEnv();
      const results = await dispatchToolCalls([], registry, env, true);

      expect(results).toEqual([]);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle complex args with nested structures', async () => {
      let capturedArgs: Record<string, unknown> | null = null;

      const registry = createToolRegistry([
        {
          definition: { name: 'tool', description: '', parameters: {} },
          executor: async (args) => {
            capturedArgs = args;
            return 'ok';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        {
          toolCallId: 'call-1',
          toolName: 'tool',
          args: {
            file_path: '/path/to/file.ts',
            old_string: 'const x = 5;',
            new_string: 'const x = 10;',
            replace_all: true,
          },
        },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, false);

      expect(results[0].isError).toBe(false);
      expect(capturedArgs).toEqual({
        file_path: '/path/to/file.ts',
        old_string: 'const x = 5;',
        new_string: 'const x = 10;',
        replace_all: true,
      });
    });

    it('should handle tools with different async timings', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'fast', description: '', parameters: {} },
          executor: async () => 'fast result',
        },
        {
          definition: { name: 'slow', description: '', parameters: {} },
          executor: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'slow result';
          },
        },
        {
          definition: { name: 'medium', description: '', parameters: {} },
          executor: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return 'medium result';
          },
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'call-1', toolName: 'fast', args: {} },
        { toolCallId: 'call-2', toolName: 'slow', args: {} },
        { toolCallId: 'call-3', toolName: 'medium', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, true);

      expect(results).toHaveLength(3);
      expect(results.every((r) => !r.isError)).toBe(true);
    });

    it('should correctly map tool call IDs in parallel execution', async () => {
      const registry = createToolRegistry([
        {
          definition: { name: 'tool1', description: '', parameters: {} },
          executor: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'result1';
          },
        },
        {
          definition: { name: 'tool2', description: '', parameters: {} },
          executor: async () => 'result2',
        },
      ]);

      const env = createMockEnv();
      const toolCalls: PendingToolCall[] = [
        { toolCallId: 'parallel-call-1', toolName: 'tool1', args: {} },
        { toolCallId: 'parallel-call-2', toolName: 'tool2', args: {} },
      ];

      const results = await dispatchToolCalls(toolCalls, registry, env, true);

      expect(results[0].toolCallId).toBe('parallel-call-1');
      expect(results[1].toolCallId).toBe('parallel-call-2');
    });
  });
});
