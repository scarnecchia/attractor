import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalExecutionEnvironment } from './local.js';
import type { ExecutionEnvironment } from '../types/environment.js';

describe('LocalExecutionEnvironment', () => {
  let testDir: string;
  let env: ExecutionEnvironment;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'attractor-test-'));
    env = createLocalExecutionEnvironment(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe('readFile', () => {
    it('should read a file with line numbers', async () => {
      await env.writeFile('test.txt', 'line 1\nline 2\nline 3');
      const content = await env.readFile('test.txt');

      expect(content).toContain('1\tline 1');
      expect(content).toContain('2\tline 2');
      expect(content).toContain('3\tline 3');
    });

    it('should respect offset and limit', async () => {
      await env.writeFile('test.txt', 'a\nb\nc\nd\ne');
      const content = await env.readFile('test.txt', 1, 2);

      expect(content).toContain('2\tb');
      expect(content).toContain('3\tc');
      expect(content).not.toContain('1\ta');
      expect(content).not.toContain('4\td');
    });

    it('should throw when file does not exist', async () => {
      await expect(env.readFile('nonexistent.txt')).rejects.toThrow();
    });

    it('should format line numbers with consistent padding', async () => {
      await env.writeFile('test.txt', Array(100).fill('x').join('\n'));
      const content = await env.readFile('test.txt', 0, 3);

      const lines = content.split('\n');
      const firstLine = lines[0];
      const thirdLine = lines[2];

      expect(firstLine).toMatch(/^\s+1\tx$/);
      expect(thirdLine).toMatch(/^\s+3\tx$/);
    });
  });

  describe('writeFile', () => {
    it('should write a file', async () => {
      await env.writeFile('test.txt', 'hello world');
      const content = await env.readFile('test.txt');

      expect(content).toContain('hello world');
    });

    it('should create parent directories', async () => {
      await env.writeFile('dir/subdir/test.txt', 'content');
      const content = await env.readFile('dir/subdir/test.txt');

      expect(content).toContain('content');
    });

    it('should overwrite existing files', async () => {
      await env.writeFile('test.txt', 'first');
      await env.writeFile('test.txt', 'second');
      const content = await env.readFile('test.txt');

      expect(content).toContain('second');
      expect(content).not.toContain('first');
    });
  });

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      await env.writeFile('test.txt', 'content');
      await env.deleteFile('test.txt');

      await expect(env.fileExists('test.txt')).resolves.toBe(false);
    });

    it('should throw when file does not exist', async () => {
      await expect(env.deleteFile('nonexistent.txt')).rejects.toThrow();
    });
  });

  describe('fileExists', () => {
    it('should return true for existing files', async () => {
      await env.writeFile('test.txt', 'content');

      await expect(env.fileExists('test.txt')).resolves.toBe(true);
    });

    it('should return false for non-existing files', async () => {
      await expect(env.fileExists('nonexistent.txt')).resolves.toBe(false);
    });
  });

  describe('listDirectory', () => {
    it('should list immediate children by default', async () => {
      await env.writeFile('file1.txt', 'a');
      await env.writeFile('file2.txt', 'b');
      await env.writeFile('dir1/nested.txt', 'c');

      const entries = await env.listDirectory('.');

      const names = entries.map((e) => e.name).filter((n) => !n.startsWith('.'));

      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).toContain('dir1');
    });

    it('should distinguish files and directories', async () => {
      await env.writeFile('file.txt', 'content');
      await env.writeFile('dir/nested.txt', 'nested');

      const entries = await env.listDirectory('.');
      const file = entries.find((e) => e.name === 'file.txt');
      const dir = entries.find((e) => e.name === 'dir');

      expect(file?.isDir).toBe(false);
      expect(dir?.isDir).toBe(true);
    });

    it('should respect depth parameter', async () => {
      await env.writeFile('dir1/dir2/file.txt', 'deep');

      const depthOne = await env.listDirectory('.', 1);
      const depthTwo = await env.listDirectory('.', 2);

      const depthOneNames = depthOne.map((e) => e.name);
      const depthTwoNames = depthTwo.map((e) => e.name);

      expect(depthOneNames).toContain('dir1');
      expect(depthTwoNames).toContain('dir1');
      expect(depthTwoNames).toContain('dir2');
    });
  });

  describe('execCommand', () => {
    it('should capture stdout', async () => {
      const result = await env.execCommand('echo "hello"');

      expect(result.stdout).toContain('hello');
      expect(result.exitCode).toBe(0);
    });

    it('should capture stderr', async () => {
      const result = await env.execCommand('bash -c "echo error >&2"');

      expect(result.stderr).toContain('error');
    });

    it('should record exit code', async () => {
      const result = await env.execCommand('bash -c "exit 42"');

      expect(result.exitCode).toBe(42);
    });

    it('should record duration', async () => {
      const result = await env.execCommand('bash -c "sleep 0.1"');

      expect(result.durationMs).toBeGreaterThanOrEqual(100);
      expect(result.durationMs).toBeLessThan(500);
    });

    it('should use default timeout of 10s', async () => {
      const result = await env.execCommand('bash -c "sleep 0.05"');

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it('should respect custom timeout', async () => {
      const result = await env.execCommand('bash -c "sleep 5"', 100);

      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain('timed out');
    });

    it('should timeout long-running commands', async () => {
      const result = await env.execCommand('bash -c "sleep 30"', 500);

      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain('timed out');
    });

    it('should use workingDir override', async () => {
      const altDir = await mkdtemp(join(tmpdir(), 'alt-'));

      try {
        await env.writeFile('file.txt', 'original');
        const result = await env.execCommand('pwd', 10000, altDir);

        expect(result.stdout).toContain(altDir);
      } finally {
        await rm(altDir, { recursive: true });
      }
    });

    it('should filter sensitive environment variables', async () => {
      const result = await env.execCommand(
        'bash -c "env | grep -i api_key || echo no_api_key"',
      );

      expect(result.stdout).toContain('no_api_key');
    });

    it('should include core environment variables', async () => {
      const result = await env.execCommand('bash -c "echo $PATH"');

      expect(result.stdout).not.toMatch(/^\s*$/);
    });

    it('should merge provided envVars', async () => {
      const result = await env.execCommand('bash -c "echo $CUSTOM_VAR"', 10000, undefined, {
        CUSTOM_VAR: 'test_value',
      });

      expect(result.stdout).toContain('test_value');
    });
  });

  describe('grep', () => {
    beforeEach(async () => {
      await env.writeFile(
        'search.txt',
        `line one
line two
match line three
match line four
final line`,
      );
    });

    it('should find matching lines', async () => {
      const result = await env.grep('match', 'search.txt');

      expect(result).toContain('match line three');
      expect(result).toContain('match line four');
    });

    it('should respect case sensitivity', async () => {
      const resultCase = await env.grep('MATCH', 'search.txt', { caseSensitive: true });
      const resultNoCase = await env.grep('MATCH', 'search.txt', { caseSensitive: false });

      expect(resultCase).not.toContain('match');
      expect(resultNoCase).toContain('match');
    });

    it('should respect maxResults limit', async () => {
      const result = await env.grep('line', 'search.txt', { maxResults: 1 });

      expect(result.split('---').length).toBeLessThanOrEqual(2);
    });
  });

  describe('glob', () => {
    it('should find matching files', async () => {
      await env.writeFile('file1.txt', 'a');
      await env.writeFile('file2.txt', 'b');
      await env.writeFile('file.js', 'c');

      const results = await env.glob('*.txt', '.');

      expect(results).toContain('file1.txt');
      expect(results).toContain('file2.txt');
      expect(results.some((f) => f.endsWith('.js'))).toBe(false);
    });

    it('should support recursive patterns', async () => {
      await env.writeFile('dir1/file.txt', 'a');
      await env.writeFile('dir2/subdir/file.txt', 'b');

      const results = await env.glob('**/*.txt', '.');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('metadata', () => {
    it('should return working directory', () => {
      expect(env.workingDirectory()).toBe(testDir);
    });

    it('should return platform', () => {
      const platform = env.platform();
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });

    it('should return os version', () => {
      const version = env.osVersion();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe('lifecycle', () => {
    it('should initialize', async () => {
      await expect(env.initialize()).resolves.not.toThrow();
    });

    it('should cleanup', async () => {
      await expect(env.cleanup()).resolves.not.toThrow();
    });
  });

  describe('environment variable policies', () => {
    it('should filter sensitive vars with inherit_core policy', async () => {
      const env2 = createLocalExecutionEnvironment(testDir, 'inherit_core');
      const result = await env2.execCommand(
        'bash -c "env | grep -i secret || echo no_secret"',
      );

      expect(result.stdout).toContain('no_secret');
    });

    it('should inherit all except sensitive with inherit_all policy', async () => {
      const env2 = createLocalExecutionEnvironment(testDir, 'inherit_all');
      const result = await env2.execCommand(
        'bash -c "env | grep -i PATH || echo no_path"',
      );

      expect(result.stdout.toLowerCase()).toContain('path');
    });

    it('should have no env with inherit_none policy', async () => {
      const env2 = createLocalExecutionEnvironment(testDir, 'inherit_none');
      const result = await env2.execCommand(
        'bash -c "env | grep -c . || echo 0"',
      );

      const count = parseInt(result.stdout.trim(), 10);
      // With inherit_none, we should have very few env vars (shell may add a few)
      expect(count).toBeLessThan(5);
    });
  });
});
