import { describe, it, expect } from 'vitest';
import { globExecutor, createGlobTool } from './glob.js';
import type { ExecutionEnvironment } from '../types/index.js';

function createMockEnv(globResults: ReadonlyArray<string>): ExecutionEnvironment {
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
    grep: async () => '',
    glob: async () => globResults,
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
  };
}

describe('glob tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createGlobTool();
      expect(tool.definition.name).toBe('glob');
      expect(tool.definition.description).toContain('Find files matching a glob pattern');
    });

    it('should have correct parameters schema', () => {
      const tool = createGlobTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('pattern');
      expect(params['properties']).toHaveProperty('path');
      expect(params['required']).toContain('pattern');
    });
  });

  describe('globExecutor', () => {
    it('should execute glob and return results', async () => {
      const env = createMockEnv(['src/file1.ts', 'src/file2.ts', 'test/test.ts']);

      const result = await globExecutor({ pattern: '**/*.ts' }, env);

      expect(result).toBe('src/file1.ts\nsrc/file2.ts\ntest/test.ts');
    });

    it('should handle single result', async () => {
      const env = createMockEnv(['src/main.ts']);

      const result = await globExecutor({ pattern: 'src/main.ts' }, env);

      expect(result).toBe('src/main.ts');
    });

    it('should handle empty results', async () => {
      const env = createMockEnv([]);

      const result = await globExecutor({ pattern: '**/*.nonexistent' }, env);

      expect(result).toContain('No files matching pattern');
      expect(result).toContain('**/*.nonexistent');
    });

    it('should pass pattern to env.glob', async () => {
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
        grep: async () => '',
        glob: async (pattern) => {
          receivedPattern = pattern;
          return [];
        },
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await globExecutor({ pattern: '**/*.ts' }, env);

      expect(receivedPattern).toBe('**/*.ts');
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
        grep: async () => '',
        glob: async (pattern, path) => {
          receivedPath = path;
          return [];
        },
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await globExecutor({ pattern: '**/*.ts' }, env);

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
        grep: async () => '',
        glob: async (pattern, path) => {
          receivedPath = path;
          return [];
        },
        initialize: async () => {},
        cleanup: async () => {},
        workingDirectory: () => '/tmp',
        platform: () => 'darwin',
        osVersion: () => '25.1.0',
      };

      await globExecutor(
        { pattern: '**/*.ts', path: '/home/user/project' },
        env,
      );

      expect(receivedPath).toBe('/home/user/project');
    });

    it('should return error when pattern is missing', async () => {
      const env = createMockEnv([]);

      const result = await globExecutor({}, env);

      expect(result).toContain('Error');
      expect(result).toContain('pattern is required');
    });

    it('should return error when pattern is not a string', async () => {
      const env = createMockEnv([]);

      const result = await globExecutor({ pattern: 123 }, env);

      expect(result).toContain('Error');
      expect(result).toContain('pattern is required');
    });
  });
});
