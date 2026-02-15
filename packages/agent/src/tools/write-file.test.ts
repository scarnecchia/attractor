import { describe, it, expect } from 'vitest';
import { writeFileExecutor, createWriteFileTool } from './write-file.js';
import type { ExecutionEnvironment } from '../types/index.js';

function createMockEnv(): {
  env: ExecutionEnvironment;
  files: Record<string, string>;
} {
  const files: Record<string, string> = {};

  return {
    files,
    env: {
      readFile: async (path) => {
        const content = files[path];
        if (!content) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return content;
      },
      writeFile: async (path, content) => {
        files[path] = content;
      },
      deleteFile: async () => {},
      fileExists: async (path) => path in files,
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
    },
  };
}

describe('write-file tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createWriteFileTool();
      expect(tool.definition.name).toBe('write_file');
      expect(tool.definition.description).toContain('Write content to a file');
    });

    it('should have correct parameters schema', () => {
      const tool = createWriteFileTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('file_path');
      expect(params['properties']).toHaveProperty('content');
      expect(params['required']).toContain('file_path');
      expect(params['required']).toContain('content');
    });
  });

  describe('writeFileExecutor', () => {
    it('should write content to a file', async () => {
      const { env, files } = createMockEnv();

      const result = await writeFileExecutor(
        { file_path: '/tmp/test.txt', content: 'hello world' },
        env,
      );

      expect(result).toContain('Wrote');
      expect(result).toContain('/tmp/test.txt');
      expect(files['/tmp/test.txt']).toBe('hello world');
    });

    it('should return correct byte count', async () => {
      const { env } = createMockEnv();

      const result = await writeFileExecutor(
        { file_path: '/tmp/test.txt', content: 'hello' },
        env,
      );

      expect(result).toContain('Wrote 5 bytes');
    });

    it('should handle UTF-8 multi-byte characters in byte count', async () => {
      const { env } = createMockEnv();

      const result = await writeFileExecutor(
        { file_path: '/tmp/test.txt', content: 'café' },
        env,
      );

      // 'café' is 5 bytes in UTF-8 (c=1, a=1, f=1, é=2)
      expect(result).toContain('Wrote 5 bytes');
    });

    it('should handle empty content', async () => {
      const { env, files } = createMockEnv();

      const result = await writeFileExecutor(
        { file_path: '/tmp/empty.txt', content: '' },
        env,
      );

      expect(result).toContain('Wrote 0 bytes');
      expect(files['/tmp/empty.txt']).toBe('');
    });

    it('should overwrite existing files', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'old content';

      const result = await writeFileExecutor(
        { file_path: '/tmp/test.txt', content: 'new content' },
        env,
      );

      expect(result).toContain('Wrote');
      expect(files['/tmp/test.txt']).toBe('new content');
    });

    it('should return error when file_path is missing', async () => {
      const { env } = createMockEnv();

      const result = await writeFileExecutor({ content: 'hello' }, env);

      expect(result).toContain('Error');
      expect(result).toContain('file_path is required');
    });

    it('should return error when file_path is not a string', async () => {
      const { env } = createMockEnv();

      const result = await writeFileExecutor({ file_path: 123, content: 'hello' }, env);

      expect(result).toContain('Error');
      expect(result).toContain('file_path is required');
    });

    it('should return error when content is missing', async () => {
      const { env } = createMockEnv();

      const result = await writeFileExecutor({ file_path: '/tmp/test.txt' }, env);

      expect(result).toContain('Error');
      expect(result).toContain('content is required');
    });

    it('should convert non-string content to string', async () => {
      const { env, files } = createMockEnv();

      const result = await writeFileExecutor(
        { file_path: '/tmp/test.txt', content: 123 as unknown as string },
        env,
      );

      expect(result).toContain('Wrote');
      expect(files['/tmp/test.txt']).toBe('123');
    });
  });
});
