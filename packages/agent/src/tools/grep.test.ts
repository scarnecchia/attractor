import { describe, it, expect } from 'vitest';
import { grepExecutor, createGrepTool } from './grep.js';
import type { ExecutionEnvironment, GrepOptions } from '../types/index.js';

function createMockEnv(grepResult: string): ExecutionEnvironment {
  return {
    readFile: async () => '',
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
    grep: async () => grepResult,
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
  };
}

describe('grep tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createGrepTool();
      expect(tool.definition.name).toBe('grep');
      expect(tool.definition.description).toContain('Search for a pattern');
    });

    it('should have correct parameters schema', () => {
      const tool = createGrepTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('pattern');
      expect(params['properties']).toHaveProperty('path');
      expect(params['properties']).toHaveProperty('case_sensitive');
      expect(params['properties']).toHaveProperty('max_results');
      expect(params['properties']).toHaveProperty('include');
      expect(params['required']).toContain('pattern');
    });
  });

  describe('grepExecutor', () => {
    it('should execute grep and return results', async () => {
      const grepOutput = 'src/file1.ts:10: const x = 42;\nsrc/file2.ts:15: const x = 100;';
      const env = createMockEnv(grepOutput);

      const result = await grepExecutor({ pattern: 'const x' }, env);

      expect(result).toContain('file1.ts');
      expect(result).toContain('file2.ts');
    });

    it('should handle empty grep results', async () => {
      const env = createMockEnv('');

      const result = await grepExecutor({ pattern: 'nonexistent' }, env);

      expect(result).toContain('No matches found');
      expect(result).toContain('nonexistent');
    });

    it('should pass pattern to env.grep', async () => {
      let receivedPattern: string | undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
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
        grep: async (pattern) => {
          receivedPattern = pattern;
          return 'results';
        },
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await grepExecutor({ pattern: 'test pattern' }, env);

      expect(receivedPattern).toBe('test pattern');
    });

    it('should default path to current directory', async () => {
      let receivedPath: string | undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
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
        grep: async (pattern, path) => {
          receivedPath = path;
          return '';
        },
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await grepExecutor({ pattern: 'test' }, env);

      expect(receivedPath).toBe('.');
    });

    it('should pass custom path', async () => {
      let receivedPath: string | undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
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
        grep: async (pattern, path) => {
          receivedPath = path;
          return '';
        },
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await grepExecutor({ pattern: 'test', path: '/home/user/project' }, env);

      expect(receivedPath).toBe('/home/user/project');
    });

    it('should pass options to env.grep', async () => {
      let receivedOptions: GrepOptions | undefined;

      const env: ExecutionEnvironment = {
        readFile: async () => '',
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
        grep: async (pattern, path, options) => {
          receivedOptions = options;
          return '';
        },
        glob: async () => [],
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await grepExecutor(
        {
          pattern: 'test',
          case_sensitive: false,
          max_results: 50,
          include: '*.ts',
        },
        env,
      );

      expect(receivedOptions).toEqual({
        caseSensitive: false,
        maxResults: 50,
        includePattern: '*.ts',
      });
    });

    it('should return error when pattern is missing', async () => {
      const env = createMockEnv('');

      const result = await grepExecutor({}, env);

      expect(result).toContain('Error');
      expect(result).toContain('pattern is required');
    });

    it('should return error when pattern is not a string', async () => {
      const env = createMockEnv('');

      const result = await grepExecutor({ pattern: 123 }, env);

      expect(result).toContain('Error');
      expect(result).toContain('pattern is required');
    });
  });
});
