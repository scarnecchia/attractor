import { describe, it, expect } from 'vitest';
import { captureGitContext } from './git-context.js';
import type { ExecutionEnvironment } from '../types/index.js';

function createMockEnv(overrides?: Partial<ExecutionEnvironment>): ExecutionEnvironment {
  return {
    readFile: async () => '',
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => false,
    listDirectory: async () => [],
    execCommand: async (command) => ({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
      durationMs: 0,
    }),
    grep: async () => '',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/repo',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
    ...overrides,
  };
}

describe('captureGitContext', () => {
  describe('Git repository context', () => {
    it('should capture branch, status, and log when in a git repo', async () => {
      const env = createMockEnv({
        execCommand: async (command) => {
          if (command.includes('branch')) {
            return {
              stdout: 'main\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('status')) {
            return {
              stdout: 'M src/file.ts\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('log')) {
            return {
              stdout: 'abc1234 feat: add feature\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          return {
            stdout: '',
            stderr: '',
            exitCode: 1,
            timedOut: false,
            durationMs: 0,
          };
        },
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBe('main');
      expect(result.status).toBe('M src/file.ts');
      expect(result.log).toBe('abc1234 feat: add feature');
    });
  });

  describe('Not a git repository', () => {
    it('should return all nulls when not in a git repo', async () => {
      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '',
          stderr: 'fatal: not a git repository',
          exitCode: 128,
          timedOut: false,
          durationMs: 10,
        }),
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBeNull();
      expect(result.status).toBeNull();
      expect(result.log).toBeNull();
    });
  });

  describe('Partial command failures', () => {
    it('should handle some commands succeeding and some failing', async () => {
      const env = createMockEnv({
        execCommand: async (command) => {
          if (command.includes('branch')) {
            return {
              stdout: 'feature-branch\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          // status and log fail
          return {
            stdout: '',
            stderr: 'fatal: not a git repository',
            exitCode: 128,
            timedOut: false,
            durationMs: 10,
          };
        },
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBe('feature-branch');
      expect(result.status).toBeNull();
      expect(result.log).toBeNull();
    });
  });

  describe('Empty git status', () => {
    it('should return null for empty status output', async () => {
      const env = createMockEnv({
        execCommand: async (command) => {
          if (command.includes('branch')) {
            return {
              stdout: 'main\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('status')) {
            return {
              stdout: '\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('log')) {
            return {
              stdout: 'abc1234 feat: commit\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          return {
            stdout: '',
            stderr: '',
            exitCode: 1,
            timedOut: false,
            durationMs: 0,
          };
        },
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBe('main');
      expect(result.status).toBeNull();
      expect(result.log).toBe('abc1234 feat: commit');
    });
  });

  describe('Multi-line output', () => {
    it('should capture multi-line status output', async () => {
      const multiLineStatus = 'M src/file1.ts\nA src/file2.ts\n?? src/new.ts\n';
      const multiLineLog = 'abc1234 feat: add feature\ndef5678 fix: bug fix\n';

      const env = createMockEnv({
        execCommand: async (command) => {
          if (command.includes('branch')) {
            return {
              stdout: 'main\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('status')) {
            return {
              stdout: multiLineStatus,
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('log')) {
            return {
              stdout: multiLineLog,
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          return {
            stdout: '',
            stderr: '',
            exitCode: 1,
            timedOut: false,
            durationMs: 0,
          };
        },
      });

      const result = await captureGitContext(env);

      expect(result.status).toContain('M src/file1.ts');
      expect(result.status).toContain('A src/file2.ts');
      expect(result.log).toContain('abc1234 feat: add feature');
      expect(result.log).toContain('def5678 fix: bug fix');
    });
  });

  describe('Exception handling', () => {
    it('should handle execCommand exceptions gracefully', async () => {
      const env = createMockEnv({
        execCommand: async () => {
          throw new Error('Command execution failed');
        },
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBeNull();
      expect(result.status).toBeNull();
      expect(result.log).toBeNull();
    });
  });

  describe('Whitespace trimming', () => {
    it('should trim whitespace from command outputs', async () => {
      const env = createMockEnv({
        execCommand: async (command) => {
          if (command.includes('branch')) {
            return {
              stdout: '  main  \n\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('status')) {
            return {
              stdout: '\n\nM file.ts\n\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          if (command.includes('log')) {
            return {
              stdout: '\nabc1234 commit\n\n',
              stderr: '',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
            };
          }
          return {
            stdout: '',
            stderr: '',
            exitCode: 1,
            timedOut: false,
            durationMs: 0,
          };
        },
      });

      const result = await captureGitContext(env);

      expect(result.branch).toBe('main');
      expect(result.status).toBe('M file.ts');
      expect(result.log).toBe('abc1234 commit');
    });
  });
});
