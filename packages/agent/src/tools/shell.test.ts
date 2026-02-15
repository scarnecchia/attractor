import { describe, it, expect } from 'vitest';
import { shellExecutor, createShellTool } from './shell.js';
import type { ExecutionEnvironment, ExecResult } from '../types/index.js';

function createMockEnv(execResult: ExecResult): ExecutionEnvironment {
  return {
    readFile: async () => '',
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => true,
    listDirectory: async () => [],
    execCommand: async (command, timeoutMs, workingDir) => execResult,
    grep: async () => '',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
  };
}

describe('shell tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createShellTool();
      expect(tool.definition.name).toBe('shell');
      expect(tool.definition.description).toContain('Execute a shell command');
    });

    it('should have correct parameters schema', () => {
      const tool = createShellTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('command');
      expect(params['properties']).toHaveProperty('timeout_ms');
      expect(params['properties']).toHaveProperty('working_dir');
      expect(params['required']).toContain('command');
    });
  });

  describe('shellExecutor', () => {
    it('should execute command and return stdout', async () => {
      const env = createMockEnv({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 10,
      });

      const result = await shellExecutor({ command: 'echo hello' }, env);

      expect(result).toContain('hello world');
      expect(result).toContain('[Exit code: 0');
    });

    it('should include stderr in output', async () => {
      const env = createMockEnv({
        stdout: 'output',
        stderr: 'error message',
        exitCode: 1,
        timedOut: false,
        durationMs: 5,
      });

      const result = await shellExecutor({ command: 'bad command' }, env);

      expect(result).toContain('output');
      expect(result).toContain('error message');
      expect(result).toContain('---stderr---');
      expect(result).toContain('[Exit code: 1');
    });

    it('should handle timeout warning', async () => {
      const env = createMockEnv({
        stdout: 'partial output',
        stderr: '',
        exitCode: 124,
        timedOut: true,
        durationMs: 5000,
      });

      const result = await shellExecutor(
        { command: 'slow command', timeout_ms: 5000 },
        env,
      );

      expect(result).toContain('partial output');
      expect(result).toContain('[WARNING: Command timed out');
      expect(result).toContain('5000ms');
    });

    it('should include duration in output', async () => {
      const env = createMockEnv({
        stdout: 'result',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 42,
      });

      const result = await shellExecutor({ command: 'test' }, env);

      expect(result).toContain('42ms');
    });

    it('should handle empty output', async () => {
      const env = createMockEnv({
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
      });

      const result = await shellExecutor({ command: 'quiet command' }, env);

      expect(result).toContain('[Exit code: 0');
    });

    it('should return error when command is missing', async () => {
      const env = createMockEnv({
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      });

      const result = await shellExecutor({}, env);

      expect(result).toContain('Error');
      expect(result).toContain('command is required');
    });

    it('should return error when command is not a string', async () => {
      const env = createMockEnv({
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      });

      const result = await shellExecutor({ command: 123 }, env);

      expect(result).toContain('Error');
      expect(result).toContain('command is required');
    });

    it('should pass timeout_ms to execCommand', async () => {
      let receivedTimeout: number | undefined = undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
        writeFile: async () => {},
        deleteFile: async () => {},
        fileExists: async () => true,
        listDirectory: async () => [],
        execCommand: async (command, timeoutMs) => {
          receivedTimeout = timeoutMs;
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            timedOut: false,
            durationMs: 0,
          };
        },
        grep: async () => '',
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await shellExecutor({ command: 'test', timeout_ms: 5000 }, env);

      expect(receivedTimeout).toBe(5000);
    });

    it('should pass working_dir to execCommand', async () => {
      let receivedWorkingDir: string | undefined = undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
        writeFile: async () => {},
        deleteFile: async () => {},
        fileExists: async () => true,
        listDirectory: async () => [],
        execCommand: async (command, timeoutMs, workingDir) => {
          receivedWorkingDir = workingDir;
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            timedOut: false,
            durationMs: 0,
          };
        },
        grep: async () => '',
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await shellExecutor(
        { command: 'test', working_dir: '/home/user/project' },
        env,
      );

      expect(receivedWorkingDir).toBe('/home/user/project');
    });
  });
});
