import { describe, it, expect } from 'vitest';
import { readFileExecutor, createReadFileTool } from './read-file.js';
import type { ExecutionEnvironment } from '../types/index.js';

function createMockEnv(fileContents: Record<string, string>): ExecutionEnvironment {
  return {
    readFile: async (path, offset, limit) => {
      if (!(path in fileContents)) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      const content = fileContents[path]!;

      if (offset !== undefined && limit !== undefined) {
        return content.slice(offset, offset + limit);
      }
      if (offset !== undefined) {
        return content.slice(offset);
      }
      return content;
    },
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async (path) => path in fileContents,
    listDirectory: async () => [],
    execCommand: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 0,
    }),
    grep: async () => '',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
  };
}

describe('read-file tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createReadFileTool();
      expect(tool.definition.name).toBe('read_file');
      expect(tool.definition.description).toContain('Read the contents of a file');
    });

    it('should have correct parameters schema', () => {
      const tool = createReadFileTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('file_path');
      expect(params['properties']).toHaveProperty('offset');
      expect(params['properties']).toHaveProperty('limit');
      expect(params['required']).toContain('file_path');
    });
  });

  describe('readFileExecutor', () => {
    it('should read file and return with line numbers', async () => {
      const env = createMockEnv({
        '/tmp/test.txt': 'hello\nworld',
      });

      const result = await readFileExecutor({ file_path: '/tmp/test.txt' }, env);

      expect(result).toContain('hello');
      expect(result).toContain('world');
      expect(result).toContain('1 |');
      expect(result).toContain('2 |');
    });

    it('should handle empty files', async () => {
      const env = createMockEnv({
        '/tmp/empty.txt': '',
      });

      const result = await readFileExecutor({ file_path: '/tmp/empty.txt' }, env);

      expect(result).toBe('   1 | ');
    });

    it('should handle offset parameter', async () => {
      const env = createMockEnv({
        '/tmp/test.txt': 'hello\nworld',
      });

      const result = await readFileExecutor(
        { file_path: '/tmp/test.txt', offset: 6 },
        env,
      );

      expect(result).toContain('world');
      expect(result).not.toContain('hello');
    });

    it('should handle limit parameter', async () => {
      const env = createMockEnv({
        '/tmp/test.txt': 'hello\nworld',
      });

      const result = await readFileExecutor(
        { file_path: '/tmp/test.txt', offset: 0, limit: 5 },
        env,
      );

      expect(result).toContain('hello');
      expect(result).not.toContain('world');
    });

    it('should return error for missing file', async () => {
      const env = createMockEnv({});

      const result = await readFileExecutor({ file_path: '/nonexistent.txt' }, env);

      expect(result).toContain('Error reading file');
      expect(result).toContain('no such file');
    });

    it('should return error when file_path is missing', async () => {
      const env = createMockEnv({});

      const result = await readFileExecutor({}, env);

      expect(result).toContain('Error');
      expect(result).toContain('file_path is required');
    });

    it('should return error when file_path is not a string', async () => {
      const env = createMockEnv({});

      const result = await readFileExecutor({ file_path: 123 }, env);

      expect(result).toContain('Error');
      expect(result).toContain('file_path is required');
    });
  });
});
