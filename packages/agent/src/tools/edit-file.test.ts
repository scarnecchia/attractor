import { describe, it, expect } from 'vitest';
import { editFileExecutor, createEditFileTool } from './edit-file.js';
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

describe('edit-file tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createEditFileTool();
      expect(tool.definition.name).toBe('edit_file');
      expect(tool.definition.description).toContain('Edit a file');
    });

    it('should have correct parameters schema', () => {
      const tool = createEditFileTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('file_path');
      expect(params['properties']).toHaveProperty('old_string');
      expect(params['properties']).toHaveProperty('new_string');
      expect(params['properties']).toHaveProperty('replace_all');
      expect(params['required']).toContain('file_path');
      expect(params['required']).toContain('old_string');
      expect(params['required']).toContain('new_string');
    });
  });

  describe('editFileExecutor', () => {
    it('should replace a unique string', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'hello world\nfoo bar';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'hello world',
          new_string: 'goodbye world',
        },
        env,
      );

      expect(result).toContain('Successfully replaced 1 occurrence');
      expect(files['/tmp/test.txt']).toBe('goodbye world\nfoo bar');
    });

    it('should handle multi-line replacements', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'line 1\nline 2\nline 3';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'line 1\nline 2',
          new_string: 'new line',
        },
        env,
      );

      expect(result).toContain('Successfully replaced 1 occurrence');
      expect(files['/tmp/test.txt']).toBe('new line\nline 3');
    });

    it('should reject non-unique match without replace_all', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'foo bar\nfoo baz';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'foo',
          new_string: 'FOO',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('appears 2 times');
      expect(files['/tmp/test.txt']).toBe('foo bar\nfoo baz');
    });

    it('should handle replace_all: true for multiple occurrences', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'foo bar\nfoo baz\nfoo qux';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'foo',
          new_string: 'FOO',
          replace_all: true,
        },
        env,
      );

      expect(result).toContain('Successfully replaced 3 occurrences');
      expect(files['/tmp/test.txt']).toBe('FOO bar\nFOO baz\nFOO qux');
    });

    it('should return error when old_string not found', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'hello world';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'nonexistent',
          new_string: 'replacement',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('old_string not found');
      expect(files['/tmp/test.txt']).toBe('hello world');
    });

    it('should return error when file does not exist', async () => {
      const { env } = createMockEnv();

      const result = await editFileExecutor(
        {
          file_path: '/nonexistent.txt',
          old_string: 'foo',
          new_string: 'bar',
        },
        env,
      );

      expect(result).toContain('Error editing file');
    });

    it('should return error when file_path is missing', async () => {
      const { env } = createMockEnv();

      const result = await editFileExecutor(
        {
          old_string: 'foo',
          new_string: 'bar',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('file_path is required');
    });

    it('should return error when old_string is missing', async () => {
      const { env } = createMockEnv();

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          new_string: 'bar',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('old_string is required');
    });

    it('should return error when new_string is missing', async () => {
      const { env } = createMockEnv();

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'foo',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('new_string is required');
    });

    it('should handle empty old_string', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'hello';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: '',
          new_string: 'x',
        },
        env,
      );

      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('should handle empty new_string (deletion)', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'hello world';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: ' world',
          new_string: '',
        },
        env,
      );

      expect(result).toContain('Successfully replaced 1 occurrence');
      expect(files['/tmp/test.txt']).toBe('hello');
    });

    it('should support replace_all with single occurrence', async () => {
      const { env, files } = createMockEnv();
      files['/tmp/test.txt'] = 'hello world';

      const result = await editFileExecutor(
        {
          file_path: '/tmp/test.txt',
          old_string: 'hello',
          new_string: 'goodbye',
          replace_all: true,
        },
        env,
      );

      expect(result).toContain('Successfully replaced 1 occurrence');
      expect(files['/tmp/test.txt']).toBe('goodbye world');
    });
  });
});
