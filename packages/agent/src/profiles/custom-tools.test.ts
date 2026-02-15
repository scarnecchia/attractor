import { describe, it, expect } from 'vitest';
import { createOpenAIProfile } from './openai/index.js';
import { createAnthropicProfile } from './anthropic/index.js';
import { createGeminiProfile } from './gemini/index.js';
import type { RegisteredTool } from '../types/index.js';

describe('Custom tool registration and collision override', () => {
  describe('AC2.5: Custom tool registration on top of profile defaults', () => {
    it('should register custom tool on Anthropic profile', () => {
      const profile = createAnthropicProfile();
      const customTool: RegisteredTool = {
        definition: {
          name: 'my_custom_tool',
          description: 'A custom tool for testing',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Test input' },
            },
            required: ['input'],
          },
        },
        executor: async () => 'custom result',
      };

      profile.toolRegistry.register(customTool);

      const registered = profile.toolRegistry.get('my_custom_tool');
      expect(registered).not.toBeNull();
      expect(registered?.definition.name).toBe('my_custom_tool');
      expect(registered?.definition.description).toBe('A custom tool for testing');
    });

    it('should include custom tool in definitions() along with profile defaults', () => {
      const profile = createAnthropicProfile();
      const customTool: RegisteredTool = {
        definition: {
          name: 'my_custom_tool',
          description: 'A custom tool for testing',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Test input' },
            },
            required: ['input'],
          },
        },
        executor: async () => 'custom result',
      };

      profile.toolRegistry.register(customTool);

      const definitions = profile.toolRegistry.definitions();
      const names = definitions.map((d) => d.name);

      // Should have all default Anthropic tools
      expect(names).toContain('read_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('write_file');
      expect(names).toContain('shell');
      expect(names).toContain('grep');
      expect(names).toContain('glob');

      // Plus the custom tool
      expect(names).toContain('my_custom_tool');
    });

    it('should register custom tool on OpenAI profile', () => {
      const profile = createOpenAIProfile();
      const customTool: RegisteredTool = {
        definition: {
          name: 'analyze_code',
          description: 'Analyzes code structure',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Code to analyze' },
            },
            required: ['code'],
          },
        },
        executor: async () => 'analysis result',
      };

      profile.toolRegistry.register(customTool);

      const registered = profile.toolRegistry.get('analyze_code');
      expect(registered).not.toBeNull();
      expect(registered?.definition.name).toBe('analyze_code');
    });

    it('should register custom tool on Gemini profile', () => {
      const profile = createGeminiProfile();
      const customTool: RegisteredTool = {
        definition: {
          name: 'validate_syntax',
          description: 'Validates syntax',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File to validate' },
            },
            required: ['file'],
          },
        },
        executor: async () => 'validation result',
      };

      profile.toolRegistry.register(customTool);

      const registered = profile.toolRegistry.get('validate_syntax');
      expect(registered).not.toBeNull();
      expect(registered?.definition.name).toBe('validate_syntax');
    });
  });

  describe('AC2.6: Tool name collision override semantics (custom overrides profile default)', () => {
    it('should override profile default read_file with custom read_file on OpenAI', () => {
      const profile = createOpenAIProfile();

      // Get the original read_file definition before override
      const originalTool = profile.toolRegistry.get('read_file');
      expect(originalTool).not.toBeNull();
      const originalDesc = originalTool?.definition.description ?? '';

      // Create a custom read_file tool with different description
      const customReadFile: RegisteredTool = {
        definition: {
          name: 'read_file',
          description: 'Custom read_file implementation',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path' },
            },
            required: ['file'],
          },
        },
        executor: async () => 'custom read result',
      };

      // Register the custom tool
      profile.toolRegistry.register(customReadFile);

      // Verify the custom tool overrides the default
      const overriddenTool = profile.toolRegistry.get('read_file');
      expect(overriddenTool).not.toBeNull();
      expect(overriddenTool?.definition.description).toBe('Custom read_file implementation');
      expect(overriddenTool?.definition.description).not.toBe(originalDesc);
    });

    it('should override apply_patch with custom apply_patch on OpenAI', () => {
      const profile = createOpenAIProfile();

      // Get the original apply_patch definition
      const originalTool = profile.toolRegistry.get('apply_patch');
      expect(originalTool).not.toBeNull();

      // Create a custom apply_patch tool
      const customApplyPatch: RegisteredTool = {
        definition: {
          name: 'apply_patch',
          description: 'Custom patch executor',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Patch content' },
            },
            required: ['content'],
          },
        },
        executor: async () => 'custom patch result',
      };

      // Register the custom tool
      profile.toolRegistry.register(customApplyPatch);

      // Verify the custom tool overrides the default
      const overriddenTool = profile.toolRegistry.get('apply_patch');
      expect(overriddenTool?.definition.description).toBe('Custom patch executor');
    });

    it('should override edit_file with custom edit_file on Anthropic', () => {
      const profile = createAnthropicProfile();

      const originalTool = profile.toolRegistry.get('edit_file');
      expect(originalTool).not.toBeNull();

      const customEditFile: RegisteredTool = {
        definition: {
          name: 'edit_file',
          description: 'Custom edit implementation',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
        },
        executor: async () => 'custom edit result',
      };

      profile.toolRegistry.register(customEditFile);

      const overriddenTool = profile.toolRegistry.get('edit_file');
      expect(overriddenTool?.definition.description).toBe('Custom edit implementation');
    });

    it('should override list_dir with custom list_dir on Gemini', () => {
      const profile = createGeminiProfile();

      const originalTool = profile.toolRegistry.get('list_dir');
      expect(originalTool).not.toBeNull();

      const customListDir: RegisteredTool = {
        definition: {
          name: 'list_dir',
          description: 'Custom directory listing',
          parameters: {
            type: 'object',
            properties: {
              directory: { type: 'string', description: 'Directory path' },
            },
            required: ['directory'],
          },
        },
        executor: async () => 'custom list result',
      };

      profile.toolRegistry.register(customListDir);

      const overriddenTool = profile.toolRegistry.get('list_dir');
      expect(overriddenTool?.definition.description).toBe('Custom directory listing');
    });

    it('definitions() should reflect overridden tool after collision', () => {
      const profile = createOpenAIProfile();

      const customReadFile: RegisteredTool = {
        definition: {
          name: 'read_file',
          description: 'Custom read_file with new parameters',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path' },
            },
            required: ['file'],
          },
        },
        executor: async () => 'custom read result',
      };

      profile.toolRegistry.register(customReadFile);

      const definitions = profile.toolRegistry.definitions();
      const readFileDef = definitions.find((d) => d.name === 'read_file');

      expect(readFileDef).not.toBeNull();
      expect(readFileDef?.description).toBe('Custom read_file with new parameters');
      expect(definitions.length).toBe(6); // Should still have 6 tools, not 7
    });
  });

  describe('unregister behavior', () => {
    it('should remove custom tool after registration', () => {
      const profile = createOpenAIProfile();

      const customTool: RegisteredTool = {
        definition: {
          name: 'test_tool',
          description: 'Test tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        executor: async () => 'test',
      };

      profile.toolRegistry.register(customTool);
      expect(profile.toolRegistry.get('test_tool')).not.toBeNull();

      profile.toolRegistry.unregister('test_tool');
      expect(profile.toolRegistry.get('test_tool')).toBeNull();
    });

    it('should not restore default tool after unregister (custom removed, not restored)', () => {
      const profile = createOpenAIProfile();

      const customReadFile: RegisteredTool = {
        definition: {
          name: 'read_file',
          description: 'Custom read_file',
          parameters: {
            type: 'object',
            properties: {
              file: { type: 'string' },
            },
            required: ['file'],
          },
        },
        executor: async () => 'custom',
      };

      // Register custom tool (overrides default)
      profile.toolRegistry.register(customReadFile);
      expect(profile.toolRegistry.get('read_file')?.definition.description).toBe(
        'Custom read_file',
      );

      // Unregister the custom tool
      profile.toolRegistry.unregister('read_file');

      // After unregister, the tool should be gone (not restored to default)
      expect(profile.toolRegistry.get('read_file')).toBeNull();
    });

    it('definitions() should not include unregistered tool', () => {
      const profile = createOpenAIProfile();

      const customTool: RegisteredTool = {
        definition: {
          name: 'temp_tool',
          description: 'Temporary tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        executor: async () => 'temp',
      };

      profile.toolRegistry.register(customTool);
      let definitions = profile.toolRegistry.definitions();
      expect(definitions.map((d) => d.name)).toContain('temp_tool');

      profile.toolRegistry.unregister('temp_tool');
      definitions = profile.toolRegistry.definitions();
      expect(definitions.map((d) => d.name)).not.toContain('temp_tool');
    });
  });

  describe('cross-profile custom tool consistency', () => {
    it('should support custom tools independently on all three profiles', () => {
      const openaiProfile = createOpenAIProfile();
      const anthropicProfile = createAnthropicProfile();
      const geminiProfile = createGeminiProfile();

      const customTool: RegisteredTool = {
        definition: {
          name: 'shared_custom',
          description: 'Shared custom tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        executor: async () => 'shared',
      };

      openaiProfile.toolRegistry.register(customTool);
      anthropicProfile.toolRegistry.register(customTool);
      geminiProfile.toolRegistry.register(customTool);

      expect(openaiProfile.toolRegistry.get('shared_custom')).not.toBeNull();
      expect(anthropicProfile.toolRegistry.get('shared_custom')).not.toBeNull();
      expect(geminiProfile.toolRegistry.get('shared_custom')).not.toBeNull();
    });

    it('should isolate custom tools per profile instance', () => {
      const profile1 = createOpenAIProfile();
      const profile2 = createOpenAIProfile();

      const customTool: RegisteredTool = {
        definition: {
          name: 'isolated_tool',
          description: 'Isolated tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        executor: async () => 'isolated',
      };

      profile1.toolRegistry.register(customTool);

      expect(profile1.toolRegistry.get('isolated_tool')).not.toBeNull();
      expect(profile2.toolRegistry.get('isolated_tool')).toBeNull();
    });
  });
});
