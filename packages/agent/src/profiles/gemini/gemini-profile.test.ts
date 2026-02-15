import { describe, it, expect } from 'vitest';
import { createGeminiProfile } from './index.js';

describe('Gemini profile', () => {
  describe('profile creation', () => {
    it('should create a profile with correct id and displayName', () => {
      const profile = createGeminiProfile();
      expect(profile.id).toBe('gemini');
      expect(profile.displayName).toBe('Gemini (gemini-cli)');
    });

    it('should have correct default model', () => {
      const profile = createGeminiProfile();
      expect(profile.defaultModel).toBe('gemini-2.5-pro');
    });

    it('should allow custom model override', () => {
      const profile = createGeminiProfile({ model: 'gemini-pro' });
      expect(profile.defaultModel).toBe('gemini-pro');
    });

    it('should support parallel tool calls', () => {
      const profile = createGeminiProfile();
      expect(profile.supportsParallelToolCalls).toBe(true);
    });

    it('should have default command timeout of 10s', () => {
      const profile = createGeminiProfile();
      expect(profile.defaultCommandTimeout).toBe(10_000);
    });

    it('should have correct project doc files', () => {
      const profile = createGeminiProfile();
      expect(profile.projectDocFiles).toContain('AGENTS.md');
      expect(profile.projectDocFiles).toContain('GEMINI.md');
    });
  });

  describe('tool registry', () => {
    it('should include read_file tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('read_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('read_file');
    });

    it('should include edit_file tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('edit_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('edit_file');
    });

    it('should include write_file tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('write_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('write_file');
    });

    it('should include shell tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('shell');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('shell');
    });

    it('should include grep tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('grep');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('grep');
    });

    it('should include glob tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('glob');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('glob');
    });

    it('should include list_dir tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('list_dir');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('list_dir');
    });

    it('should NOT include apply_patch tool', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      expect(tool).toBeNull();
    });
  });

  describe('read_file tool definition', () => {
    it('should have path parameter (not file_path)', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('read_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('path');
      expect(properties).not.toHaveProperty('file_path');
    });

    it('should require path parameter', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('read_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      expect(params['required']).toContain('path');
    });

    it('should have offset parameter (0-based)', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('read_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('offset');
      const offsetDesc = (properties['offset'] as Record<string, unknown>)[
        'description'
      ] as string;
      expect(offsetDesc).toContain('0-based');
    });
  });

  describe('edit_file tool definition', () => {
    it('should have expected_replacements parameter (not replace_all)', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('expected_replacements');
      expect(properties).not.toHaveProperty('replace_all');
    });

    it('should require file_path, old_string, new_string', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      expect(params['required']).toContain('file_path');
      expect(params['required']).toContain('old_string');
      expect(params['required']).toContain('new_string');
    });

    it('expected_replacements should be optional with default 1', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      const replacementDesc = (
        properties['expected_replacements'] as Record<string, unknown>
      )['description'] as string;
      expect(replacementDesc).toContain('default: 1');
    });
  });

  describe('glob tool definition', () => {
    it('should have case_sensitive parameter', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('glob');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('case_sensitive');
    });

    it('case_sensitive should default to false', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('glob');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      const caseSensitiveDesc = (
        properties['case_sensitive'] as Record<string, unknown>
      )['description'] as string;
      expect(caseSensitiveDesc).toContain('default: false');
    });
  });

  describe('list_dir tool definition', () => {
    it('should have path, ignore, respect_git_ignore parameters', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('list_dir');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('path');
      expect(properties).toHaveProperty('ignore');
      expect(properties).toHaveProperty('respect_git_ignore');
    });

    it('should require path parameter only', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('list_dir');
      const params = tool!.definition.parameters as Record<string, unknown>;
      expect(params['required']).toContain('path');
      expect((params['required'] as Array<string>).length).toBe(1);
    });

    it('respect_git_ignore should default to true', () => {
      const profile = createGeminiProfile();
      const tool = profile.toolRegistry.get('list_dir');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      const respGitDesc = (
        properties['respect_git_ignore'] as Record<string, unknown>
      )['description'] as string;
      expect(respGitDesc).toContain('default: true');
    });
  });

  describe('system prompt', () => {
    it('should be a function', () => {
      const profile = createGeminiProfile();
      expect(typeof profile.buildSystemPrompt).toBe('function');
    });

    it('should return a string containing identity', () => {
      const profile = createGeminiProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'gemini-2.5-pro',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('coding assistant');
      expect(prompt).toContain('gemini-cli');
    });

    it('should return a string containing safety and approval guidance', () => {
      const profile = createGeminiProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'gemini-2.5-pro',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('Safety');
      expect(prompt).toContain('confirmation');
    });

    it('should return a string containing code conventions', () => {
      const profile = createGeminiProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'gemini-2.5-pro',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('Code Conventions');
      expect(prompt).toContain('Analyze');
    });

    it('should include context information', () => {
      const profile = createGeminiProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'gemini-2.5-pro',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('darwin');
      expect(prompt).toContain('25.1.0');
      expect(prompt).toContain('/tmp');
      expect(prompt).toContain('main');
    });
  });

  describe('tool definitions details', () => {
    it('definitions() should return all profile tools', () => {
      const profile = createGeminiProfile();
      const definitions = profile.toolRegistry.definitions();
      const names = definitions.map((d) => d.name);

      expect(names).toContain('read_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('write_file');
      expect(names).toContain('shell');
      expect(names).toContain('grep');
      expect(names).toContain('glob');
      expect(names).toContain('list_dir');
      expect(names.length).toBe(7);
    });
  });
});
