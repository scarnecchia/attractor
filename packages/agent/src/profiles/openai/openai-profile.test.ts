import { describe, it, expect } from 'vitest';
import { createOpenAIProfile } from './index.js';

describe('OpenAI profile', () => {
  describe('profile creation', () => {
    it('should create a profile with correct id and displayName', () => {
      const profile = createOpenAIProfile();
      expect(profile.id).toBe('openai');
      expect(profile.displayName).toBe('OpenAI (codex-rs)');
    });

    it('should have correct default model', () => {
      const profile = createOpenAIProfile();
      expect(profile.defaultModel).toBe('o4-mini');
    });

    it('should allow custom model override', () => {
      const profile = createOpenAIProfile({ model: 'gpt-4-turbo' });
      expect(profile.defaultModel).toBe('gpt-4-turbo');
    });

    it('should support parallel tool calls', () => {
      const profile = createOpenAIProfile();
      expect(profile.supportsParallelToolCalls).toBe(true);
    });

    it('should have default command timeout of 10s', () => {
      const profile = createOpenAIProfile();
      expect(profile.defaultCommandTimeout).toBe(10_000);
    });

    it('should have correct project doc files', () => {
      const profile = createOpenAIProfile();
      expect(profile.projectDocFiles).toContain('AGENTS.md');
      expect(profile.projectDocFiles).toContain('.codex/instructions.md');
    });
  });

  describe('tool registry', () => {
    it('should include read_file tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('read_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('read_file');
    });

    it('should include apply_patch tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('apply_patch');
    });

    it('should include write_file tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('write_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('write_file');
    });

    it('should include shell tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('shell');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('shell');
    });

    it('should include grep tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('grep');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('grep');
    });

    it('should include glob tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('glob');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('glob');
    });

    it('should NOT include edit_file tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('edit_file');
      expect(tool).toBeNull();
    });

    it('should NOT include list_dir tool', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('list_dir');
      expect(tool).toBeNull();
    });
  });

  describe('apply_patch tool definition', () => {
    it('should have correct parameter schema', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      expect(tool).not.toBeNull();

      const params = tool!.definition.parameters;
      expect(params['properties']).toHaveProperty('patch');
      expect(params['required']).toContain('patch');
    });

    it('should describe v4a patch format', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      expect(tool?.definition.description).toContain('v4a');
    });
  });

  describe('system prompt', () => {
    it('should be a function', () => {
      const profile = createOpenAIProfile();
      expect(typeof profile.buildSystemPrompt).toBe('function');
    });

    it('should return a string containing identity', () => {
      const profile = createOpenAIProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'o4-mini',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('coding assistant');
      expect(prompt).toContain('codex-rs');
    });

    it('should return a string containing apply_patch guidance', () => {
      const profile = createOpenAIProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'o4-mini',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('apply_patch');
      expect(prompt).toContain('v4a patch format');
    });

    it('should return a string containing coding best practices', () => {
      const profile = createOpenAIProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'o4-mini',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('Fix root causes');
      expect(prompt).toContain('testing');
    });

    it('should include context information', () => {
      const profile = createOpenAIProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'o4-mini',
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
    it('apply_patch should have string parameter', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      const patchDef = properties['patch'] as Record<string, unknown>;
      expect(patchDef['type']).toBe('string');
    });

    it('read_file should have file_path parameter', () => {
      const profile = createOpenAIProfile();
      const tool = profile.toolRegistry.get('read_file');
      const params = tool!.definition.parameters;
      expect(params['properties']).toHaveProperty('file_path');
    });

    it('definitions() should return all profile tools', () => {
      const profile = createOpenAIProfile();
      const definitions = profile.toolRegistry.definitions();
      const names = definitions.map((d) => d.name);

      expect(names).toContain('read_file');
      expect(names).toContain('apply_patch');
      expect(names).toContain('write_file');
      expect(names).toContain('shell');
      expect(names).toContain('grep');
      expect(names).toContain('glob');
      expect(names.length).toBe(6);
    });
  });
});
