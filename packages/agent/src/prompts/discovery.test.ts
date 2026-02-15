import { describe, it, expect } from 'vitest';
import { discoverProjectDocs } from './discovery.js';
import type { ExecutionEnvironment, ExecResult } from '../types/index.js';

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
    workingDirectory: () => '/repo/packages/agent',
    platform: () => 'darwin',
    osVersion: () => '25.1.0',
    ...overrides,
  };
}

describe('discoverProjectDocs', () => {
  describe('AC9.3: Project doc discovery from git root to working dir', () => {
    it('should discover AGENTS.md at git root and CLAUDE.md in subdirectory', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# Root agents file',
        '/repo/packages/agent/CLAUDE.md': '# Subdir claude file',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('# Root agents file');
      expect(result).toContain('# Subdir claude file');
      expect(result).toContain('## ./AGENTS.md');
      expect(result).toContain('## packages/agent/CLAUDE.md');
    });
  });

  describe('AC9.4: Profile-specific file discovery', () => {
    it('should discover CLAUDE.md for anthropic profile', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# Agents',
        '/repo/CLAUDE.md': '# Claude instructions',
        '/repo/GEMINI.md': '# Gemini instructions',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('Claude instructions');
      expect(result).not.toContain('Gemini instructions');
    });

    it('should discover GEMINI.md for gemini profile', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# Agents',
        '/repo/CLAUDE.md': '# Claude instructions',
        '/repo/GEMINI.md': '# Gemini instructions',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'gemini');

      expect(result).not.toContain('Claude instructions');
      expect(result).toContain('Gemini instructions');
    });

    it('should discover .codex/instructions.md for openai profile', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# Agents',
        '/repo/.codex/instructions.md': '# OpenAI instructions',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'openai');

      expect(result).toContain('OpenAI instructions');
      expect(result).toContain('Agents');
    });

    it('should always discover AGENTS.md regardless of profile', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# Agents for all',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const resultAnthropicResult = await discoverProjectDocs(env, 'anthropic');
      const resultOpenAiResult = await discoverProjectDocs(env, 'openai');
      const resultGeminiResult = await discoverProjectDocs(env, 'gemini');

      expect(resultAnthropicResult).toContain('Agents for all');
      expect(resultOpenAiResult).toContain('Agents for all');
      expect(resultGeminiResult).toContain('Agents for all');
    });
  });

  describe('AC9.5: 32KB budget truncation', () => {
    it('should truncate content exceeding 32KB budget', async () => {
      const largeContent = 'a'.repeat(20 * 1024); // 20KB
      const files: Record<string, string> = {
        '/repo/AGENTS.md': largeContent,
        '/repo/CLAUDE.md': largeContent, // This will exceed budget
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('[Project instructions truncated at 32KB]');
      // Second file should not be fully loaded
      const agentsCount = (result.match(/a/g) || []).length;
      expect(agentsCount).toBeLessThan(largeContent.length * 2);
    });

    it('should include truncation marker when budget exceeded', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': 'a'.repeat(25 * 1024),
        '/repo/CLAUDE.md': 'b'.repeat(10 * 1024),
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('[Project instructions truncated at 32KB]');
    });
  });

  describe('Root-level files before subdirectory files', () => {
    it('should load root-level files before subdirectory files', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': 'Root AGENTS',
        '/repo/packages/AGENTS.md': 'Packages AGENTS',
        '/repo/packages/agent/AGENTS.md': 'Agent AGENTS',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
        workingDirectory: () => '/repo/packages/agent',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      const rootPos = result.indexOf('Root AGENTS');
      const packagesPos = result.indexOf('Packages AGENTS');
      const agentPos = result.indexOf('Agent AGENTS');

      expect(rootPos).toBeGreaterThanOrEqual(0);
      expect(packagesPos).toBeGreaterThanOrEqual(0);
      expect(agentPos).toBeGreaterThanOrEqual(0);
      expect(rootPos).toBeLessThan(packagesPos);
      expect(packagesPos).toBeLessThan(agentPos);
    });
  });

  describe('No git repo fallback', () => {
    it('should use working directory as root when git command fails', async () => {
      const files: Record<string, string> = {
        '/repo/packages/agent/AGENTS.md': '# Agent AGENTS',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '',
          stderr: 'not a git repo',
          exitCode: 128,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => files[path] || '',
        workingDirectory: () => '/repo/packages/agent',
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('Agent AGENTS');
    });
  });

  describe('File reading errors', () => {
    it('should skip files that cannot be read', async () => {
      const files: Record<string, string> = {
        '/repo/AGENTS.md': '# AGENTS file',
        '/repo/CLAUDE.md': '# CLAUDE file',
      };

      const env = createMockEnv({
        execCommand: async () => ({
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          durationMs: 10,
        }),
        fileExists: async (path: string) => Boolean(files[path]),
        readFile: async (path: string) => {
          if (path === '/repo/CLAUDE.md') {
            throw new Error('Permission denied');
          }
          return files[path] || '';
        },
      });

      const result = await discoverProjectDocs(env, 'anthropic');

      expect(result).toContain('AGENTS file');
      expect(result).not.toContain('CLAUDE file');
    });
  });
});
