import { describe, it, expect } from 'vitest';
import { listDirExecutor } from './shared-tools.js';
import type { ExecutionEnvironment, DirEntry } from '../types/index.js';

function createMockEnv(
  entries: ReadonlyArray<DirEntry>,
  gitIgnoreContent?: string,
): ExecutionEnvironment {
  return {
    readFile: async (path) => {
      if (path === '/.gitignore' && gitIgnoreContent !== undefined) {
        return gitIgnoreContent;
      }
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    },
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async (path) => {
      if (path === '/.gitignore') return gitIgnoreContent !== undefined;
      return false;
    },
    listDirectory: async (path) => {
      if (path === '/') return entries;
      throw new Error(`ENOENT: no such file or directory '${path}'`);
    },
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

describe('listDirExecutor', () => {
  describe('basic directory listing', () => {
    it('should list files and directories with proper formatting', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 1024 },
        { name: 'folder', isDir: true, size: null },
        { name: 'README.md', isDir: false, size: 512 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).toContain('file.txt (1024 bytes)');
      expect(result).toContain('folder/');
      expect(result).toContain('README.md (512 bytes)');
    });

    it('should handle empty directory', async () => {
      const env = createMockEnv([]);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).toBe('Directory is empty or all entries were filtered.');
    });

    it('should format directories with trailing slash', async () => {
      const entries: Array<DirEntry> = [
        { name: 'src', isDir: true, size: null },
        { name: 'lib', isDir: true, size: null },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      const lines = result.split('\n');
      expect(lines).toContain('src/');
      expect(lines).toContain('lib/');
    });

    it('should format files with size information', async () => {
      const entries: Array<DirEntry> = [
        { name: 'app.js', isDir: false, size: 2048 },
        { name: 'config.json', isDir: false, size: 256 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).toContain('app.js (2048 bytes)');
      expect(result).toContain('config.json (256 bytes)');
    });

    it('should handle null size for files', async () => {
      const entries: Array<DirEntry> = [
        { name: 'symlink', isDir: false, size: null },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).toBe('symlink');
    });
  });

  describe('ignore parameter with simpleMatch patterns', () => {
    it('should filter entries matching ignore patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
        { name: '.DS_Store', isDir: false, size: 50 },
        { name: 'node_modules', isDir: true, size: null },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['.DS_Store', 'node_modules'] },
        env,
      );

      expect(result).toContain('file.txt');
      expect(result).not.toContain('.DS_Store');
      expect(result).not.toContain('node_modules');
    });

    it('should handle exact match patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'test.js', isDir: false, size: 100 },
        { name: 'test.ts', isDir: false, size: 200 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['test.js'] },
        env,
      );

      expect(result).not.toContain('test.js');
      expect(result).toContain('test.ts');
    });

    it('should handle wildcard patterns with *', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
        { name: 'file.js', isDir: false, size: 100 },
        { name: 'data.json', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file.*'] },
        env,
      );

      expect(result).not.toContain('file.txt');
      expect(result).not.toContain('file.js');
      expect(result).toContain('data.json');
    });

    it('should handle * wildcard matching everything', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file1', isDir: false, size: 100 },
        { name: 'file2', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['*'] },
        env,
      );

      expect(result).toBe('Directory is empty or all entries were filtered.');
    });

    it('should handle prefix patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: '.env', isDir: false, size: 100 },
        { name: '.gitignore', isDir: false, size: 50 },
        { name: '.DS_Store', isDir: false, size: 25 },
        { name: 'README.md', isDir: false, size: 200 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['.'] },
        env,
      );

      expect(result).not.toContain('.env');
      expect(result).not.toContain('.gitignore');
      expect(result).not.toContain('.DS_Store');
      expect(result).toContain('README.md');
    });

    it('should handle multiple ignore patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file1.js', isDir: false, size: 100 },
        { name: 'file2.ts', isDir: false, size: 100 },
        { name: 'dist', isDir: true, size: null },
        { name: 'src', isDir: true, size: null },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['*.js', '*.ts', 'dist'] },
        env,
      );

      expect(result).not.toContain('file1.js');
      expect(result).not.toContain('file2.ts');
      expect(result).not.toContain('dist');
      expect(result).toContain('src');
    });
  });

  describe('regex metacharacter escaping in simpleMatch', () => {
    it('should escape ( and ) in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file(1).txt', isDir: false, size: 100 },
        { name: 'file1.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file(1).txt'] },
        env,
      );

      expect(result).not.toContain('file(1).txt');
      expect(result).toContain('file1.txt');
    });

    it('should escape [ and ] in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file[a].txt', isDir: false, size: 100 },
        { name: 'filea.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file[a].txt'] },
        env,
      );

      expect(result).not.toContain('file[a].txt');
      expect(result).toContain('filea.txt');
    });

    it('should escape . in patterns (except where replaced by *)', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
        { name: 'filextxt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file.txt'] },
        env,
      );

      expect(result).not.toContain('file.txt');
      expect(result).toContain('filextxt');
    });

    it('should escape + in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file+.txt', isDir: false, size: 100 },
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file+.txt'] },
        env,
      );

      expect(result).not.toContain('file+.txt');
      expect(result).toContain('file.txt');
    });

    it('should escape ? in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file?.txt', isDir: false, size: 100 },
        { name: 'file1.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file?.txt'] },
        env,
      );

      expect(result).not.toContain('file?.txt');
      expect(result).toContain('file1.txt');
    });

    it('should escape { and } in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file{1}.txt', isDir: false, size: 100 },
        { name: 'file1.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file{1}.txt'] },
        env,
      );

      expect(result).not.toContain('file{1}.txt');
      expect(result).toContain('file1.txt');
    });

    it('should escape | in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file|name.txt', isDir: false, size: 100 },
        { name: 'filename.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file|name.txt'] },
        env,
      );

      expect(result).not.toContain('file|name.txt');
      expect(result).toContain('filename.txt');
    });

    it('should escape ^ in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: '^file.txt', isDir: false, size: 100 },
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['^file.txt'] },
        env,
      );

      expect(result).not.toContain('^file.txt');
      expect(result).toContain('file.txt');
    });

    it('should escape $ in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file$.txt', isDir: false, size: 100 },
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file$.txt'] },
        env,
      );

      expect(result).not.toContain('file$.txt');
      expect(result).toContain('file.txt');
    });

    it('should escape backslash in patterns', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file\\name.txt', isDir: false, size: 100 },
        { name: 'filename.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file\\name.txt'] },
        env,
      );

      expect(result).not.toContain('file\\name.txt');
      expect(result).toContain('filename.txt');
    });

    it('should handle wildcard * together with escaped metacharacters', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file(1).txt', isDir: false, size: 100 },
        { name: 'file(2).js', isDir: false, size: 100 },
        { name: 'file1.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: ['file(*).*'] },
        env,
      );

      expect(result).not.toContain('file(1).txt');
      expect(result).not.toContain('file(2).js');
      expect(result).toContain('file1.txt');
    });
  });

  describe('truncation at 500 lines', () => {
    it('should truncate output when exceeding 500 lines', async () => {
      const entries: Array<DirEntry> = [];
      for (let i = 0; i < 510; i++) {
        entries.push({ name: `file${i}.txt`, isDir: false, size: 100 });
      }
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);
      const lines = result.split('\n');

      expect(lines.length).toBeLessThanOrEqual(502); // 500 + truncation message line
      expect(result).toContain('[truncated: 10 more entries]');
    });

    it('should not truncate when at exactly 500 lines', async () => {
      const entries: Array<DirEntry> = [];
      for (let i = 0; i < 500; i++) {
        entries.push({ name: `file${i}.txt`, isDir: false, size: 100 });
      }
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);
      const lines = result.split('\n');

      expect(lines.length).toBe(500);
      expect(result).not.toContain('[truncated');
    });

    it('should not truncate when below 500 lines', async () => {
      const entries: Array<DirEntry> = [];
      for (let i = 0; i < 100; i++) {
        entries.push({ name: `file${i}.txt`, isDir: false, size: 100 });
      }
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).not.toContain('[truncated');
    });
  });

  describe('error handling', () => {
    it('should return error message when path is missing', async () => {
      const env = createMockEnv([]);

      const result = await listDirExecutor({}, env);

      expect(result).toContain('Error: path is required');
    });

    it('should return error message when path is not a string', async () => {
      const env = createMockEnv([]);

      const result = await listDirExecutor({ path: 123 }, env);

      expect(result).toContain('Error: path is required');
    });

    it('should handle listDirectory throwing an error', async () => {
      const env: ExecutionEnvironment = {
        readFile: async () => '',
        writeFile: async () => {},
        deleteFile: async () => {},
        fileExists: async () => false,
        listDirectory: async () => {
          throw new Error('Permission denied');
        },
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

      const result = await listDirExecutor({ path: '/no-access' }, env);

      expect(result).toContain('Error listing directory');
      expect(result).toContain('Permission denied');
    });

    it('should handle non-Error exceptions', async () => {
      const env: ExecutionEnvironment = {
        readFile: async () => '',
        writeFile: async () => {},
        deleteFile: async () => {},
        fileExists: async () => false,
        listDirectory: async () => {
          throw 'string error';
        },
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

      const result = await listDirExecutor({ path: '/no-access' }, env);

      expect(result).toContain('Error listing directory');
      expect(result).toContain('string error');
    });
  });

  describe('respect_git_ignore parameter', () => {
    it('should default to true when not specified', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor({ path: '/' }, env);

      expect(result).toContain('file.txt');
    });

    it('should respect respect_git_ignore=true', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', respect_git_ignore: true },
        env,
      );

      expect(result).toContain('file.txt');
    });

    it('should respect respect_git_ignore=false', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', respect_git_ignore: false },
        env,
      );

      expect(result).toContain('file.txt');
    });
  });

  describe('parameter combinations', () => {
    it('should apply both ignore and respect_git_ignore together', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file.txt', isDir: false, size: 100 },
        { name: '.DS_Store', isDir: false, size: 50 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        {
          path: '/',
          ignore: ['.DS_Store'],
          respect_git_ignore: true,
        },
        env,
      );

      expect(result).toContain('file.txt');
      expect(result).not.toContain('.DS_Store');
    });

    it('should handle empty ignore array', async () => {
      const entries: Array<DirEntry> = [
        { name: 'file1.txt', isDir: false, size: 100 },
        { name: 'file2.txt', isDir: false, size: 100 },
      ];
      const env = createMockEnv(entries);

      const result = await listDirExecutor(
        { path: '/', ignore: [] },
        env,
      );

      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });
  });
});
