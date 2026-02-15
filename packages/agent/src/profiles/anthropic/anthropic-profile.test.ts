import { describe, it, expect } from 'vitest';
import { createAnthropicProfile } from './index.js';

describe('Anthropic profile', () => {
  describe('profile creation', () => {
    it('should create a profile with correct id and displayName', () => {
      const profile = createAnthropicProfile();
      expect(profile.id).toBe('anthropic');
      expect(profile.displayName).toBe('Anthropic (Claude Code)');
    });

    it('should have correct default model', () => {
      const profile = createAnthropicProfile();
      expect(profile.defaultModel).toBe('claude-sonnet-4-5-20250929');
    });

    it('should allow custom model override', () => {
      const profile = createAnthropicProfile({ model: 'claude-opus-4-6' });
      expect(profile.defaultModel).toBe('claude-opus-4-6');
    });

    it('should support parallel tool calls', () => {
      const profile = createAnthropicProfile();
      expect(profile.supportsParallelToolCalls).toBe(true);
    });

    it('should have default command timeout of 120s', () => {
      const profile = createAnthropicProfile();
      expect(profile.defaultCommandTimeout).toBe(120_000);
    });

    it('should have correct project doc files', () => {
      const profile = createAnthropicProfile();
      expect(profile.projectDocFiles).toContain('AGENTS.md');
      expect(profile.projectDocFiles).toContain('CLAUDE.md');
    });
  });

  describe('tool registry', () => {
    it('should include read_file tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('read_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('read_file');
    });

    it('should include edit_file tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('edit_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('edit_file');
    });

    it('should include write_file tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('write_file');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('write_file');
    });

    it('should include shell tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('shell');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('shell');
    });

    it('should include grep tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('grep');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('grep');
    });

    it('should include glob tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('glob');
      expect(tool).not.toBeNull();
      expect(tool?.definition.name).toBe('glob');
    });

    it('should NOT include apply_patch tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('apply_patch');
      expect(tool).toBeNull();
    });

    it('should NOT include list_dir tool', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('list_dir');
      expect(tool).toBeNull();
    });
  });

  describe('edit_file tool definition', () => {
    it('should have correct parameter schema', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('edit_file');
      expect(tool).not.toBeNull();

      const params = tool!.definition.parameters;
      expect(params['properties']).toHaveProperty('file_path');
      expect(params['properties']).toHaveProperty('old_string');
      expect(params['properties']).toHaveProperty('new_string');
      expect(params['properties']).toHaveProperty('replace_all');
      expect(params['required']).toContain('file_path');
      expect(params['required']).toContain('old_string');
      expect(params['required']).toContain('new_string');
    });

    it('should describe uniqueness requirement', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      const oldStringDef = properties['old_string'] as Record<string, unknown>;
      const oldStringDesc = oldStringDef['description'] as string;
      expect(oldStringDesc).toContain('unique');
    });
  });

  describe('system prompt', () => {
    it('should be a function', () => {
      const profile = createAnthropicProfile();
      expect(typeof profile.buildSystemPrompt).toBe('function');
    });

    it('should return a string containing identity', () => {
      const profile = createAnthropicProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'claude-sonnet-4-5-20250929',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('interactive coding assistant');
      expect(prompt).toContain('Claude Code');
    });

    it('should return a string containing edit_file guidance', () => {
      const profile = createAnthropicProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'claude-sonnet-4-5-20250929',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('edit_file');
      expect(prompt).toContain('old_string');
      expect(prompt).toContain('must be unique');
    });

    it('should return a string containing read before edit guidance', () => {
      const profile = createAnthropicProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'claude-sonnet-4-5-20250929',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('Read the file first');
      expect(prompt).toContain('read_file');
    });

    it('should return a string containing coding standards', () => {
      const profile = createAnthropicProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'claude-sonnet-4-5-20250929',
        projectDocs: '',
        userInstruction: null,
      });

      expect(prompt).toContain('Fix root causes');
      expect(prompt).toContain('consistency');
    });

    it('should include context information', () => {
      const profile = createAnthropicProfile();
      const prompt = profile.buildSystemPrompt({
        platform: 'darwin',
        osVersion: '25.1.0',
        workingDirectory: '/tmp',
        gitBranch: 'main',
        gitStatus: null,
        gitLog: null,
        date: '2026-02-15',
        model: 'claude-sonnet-4-5-20250929',
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
    it('edit_file should have old_string and new_string parameters', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters;
      expect(params['properties']).toHaveProperty('old_string');
      expect(params['properties']).toHaveProperty('new_string');
    });

    it('edit_file should have replace_all optional parameter', () => {
      const profile = createAnthropicProfile();
      const tool = profile.toolRegistry.get('edit_file');
      const params = tool!.definition.parameters as Record<string, unknown>;
      const properties = params['properties'] as Record<string, unknown>;
      expect(properties).toHaveProperty('replace_all');
      const replaceAllDef = properties['replace_all'] as Record<string, unknown>;
      expect(replaceAllDef['type']).toBe('boolean');
    });

    it('definitions() should return all profile tools', () => {
      const profile = createAnthropicProfile();
      const definitions = profile.toolRegistry.definitions();
      const names = definitions.map((d) => d.name);

      expect(names).toContain('read_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('write_file');
      expect(names).toContain('shell');
      expect(names).toContain('grep');
      expect(names).toContain('glob');
      expect(names.length).toBe(6);
    });
  });
});
