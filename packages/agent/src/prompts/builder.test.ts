import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './builder.js';
import type { ProviderProfile, SystemPromptContext, ToolRegistry } from '../types/index.js';
import { createToolRegistry } from '../types/tool.js';

function createMockProfile(overrides?: Partial<ProviderProfile>): ProviderProfile {
  const toolRegistry: ToolRegistry = createToolRegistry([
    {
      definition: {
        name: 'test_tool',
        description: 'A test tool for testing',
        parameters: {},
      },
      executor: async () => 'test',
    },
  ]);

  return {
    id: 'anthropic',
    displayName: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    toolRegistry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: () => 'Base system prompt from provider',
    projectDocFiles: ['AGENTS.md', 'CLAUDE.md'],
    defaultCommandTimeout: 30000,
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<SystemPromptContext>): SystemPromptContext {
  return {
    platform: 'darwin',
    osVersion: '25.1.0',
    workingDirectory: '/repo/packages/agent',
    gitBranch: 'main',
    gitStatus: null,
    gitLog: null,
    date: '2026-02-14',
    model: 'claude-3-5-sonnet-20241022',
    projectDocs: '',
    userInstruction: null,
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  describe('AC9.1: Provider-specific base instructions', () => {
    it('should include provider base instructions as first layer', () => {
      const profile = createMockProfile({
        buildSystemPrompt: () => 'Custom base from provider',
      });
      const context = createMockContext();

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('Custom base from provider');
      const baseIndex = result.indexOf('Custom base from provider');
      const envIndex = result.indexOf('<environment>');
      expect(baseIndex).toBeLessThan(envIndex);
    });
  });

  describe('AC9.2: Environment context', () => {
    it('should include environment context block with all required fields', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        platform: 'linux',
        osVersion: '5.15.0',
        workingDirectory: '/home/user/project',
        gitBranch: 'feature/test',
        date: '2026-02-14',
        model: 'claude-3-5-sonnet-20241022',
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('<environment>');
      expect(result).toContain('</environment>');
      expect(result).toContain('Working directory: /home/user/project');
      expect(result).toContain('Is git repository: true');
      expect(result).toContain('Git branch: feature/test');
      expect(result).toContain('Platform: linux');
      expect(result).toContain('OS version: 5.15.0');
      expect(result).toContain('Today\'s date: 2026-02-14');
      expect(result).toContain('Model: claude-3-5-sonnet-20241022');
    });

    it('should handle non-git-repo scenario', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        gitBranch: null,
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('Is git repository: false');
      expect(result).not.toContain('Git branch:');
    });
  });

  describe('AC9.6: User instruction override', () => {
    it('should place user instruction last after project docs', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        projectDocs: 'Project documentation',
        userInstruction: 'User override instructions',
      });

      const result = buildSystemPrompt(profile, context);

      const userIndex = result.indexOf('User override instructions');
      const projectIndex = result.indexOf('Project documentation');
      const envIndex = result.indexOf('<environment>');

      expect(envIndex).toBeLessThan(projectIndex);
      expect(projectIndex).toBeLessThan(userIndex);
    });

    it('should include user instruction even without project docs', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        projectDocs: '',
        userInstruction: 'User instructions only',
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('User instructions only');
    });
  });

  describe('All 5 layers in correct order', () => {
    it('should assemble all layers in correct order', () => {
      const profile = createMockProfile({
        buildSystemPrompt: () => 'Layer 1: Provider base',
      });
      const context = createMockContext({
        projectDocs: 'Layer 4: Project docs',
        userInstruction: 'Layer 5: User instruction',
      });

      const result = buildSystemPrompt(profile, context);

      const layer1Index = result.indexOf('Layer 1: Provider base');
      const layer2Index = result.indexOf('<environment>');
      const layer3Index = result.indexOf('# Available Tools');
      const layer4Index = result.indexOf('Layer 4: Project docs');
      const layer5Index = result.indexOf('Layer 5: User instruction');

      expect(layer1Index).toBeLessThan(layer2Index);
      expect(layer2Index).toBeLessThan(layer3Index);
      expect(layer3Index).toBeLessThan(layer4Index);
      expect(layer4Index).toBeLessThan(layer5Index);
    });
  });

  describe('Missing optional layers', () => {
    it('should handle missing project docs gracefully', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        projectDocs: '',
        userInstruction: 'User instruction',
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).not.toContain('  \n');
      expect(result).toContain('User instruction');
    });

    it('should handle missing user instruction gracefully', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        projectDocs: 'Project docs',
        userInstruction: null,
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('Project docs');
      expect(result).not.toContain('null');
    });

    it('should handle both project docs and user instruction missing', () => {
      const profile = createMockProfile();
      const context = createMockContext({
        projectDocs: '',
        userInstruction: null,
      });

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('Base system prompt from provider');
      expect(result).toContain('<environment>');
      expect(result).toContain('# Available Tools');
    });
  });

  describe('Tool descriptions layer', () => {
    it('should include all tool definitions', () => {
      const toolRegistry = createToolRegistry([
        {
          definition: {
            name: 'tool_one',
            description: 'Description of tool one',
            parameters: {},
          },
          executor: async () => '',
        },
        {
          definition: {
            name: 'tool_two',
            description: 'Description of tool two',
            parameters: {},
          },
          executor: async () => '',
        },
      ]);

      const profile = createMockProfile({
        toolRegistry,
      });
      const context = createMockContext();

      const result = buildSystemPrompt(profile, context);

      expect(result).toContain('# Available Tools');
      expect(result).toContain('## tool_one');
      expect(result).toContain('Description of tool one');
      expect(result).toContain('## tool_two');
      expect(result).toContain('Description of tool two');
    });

    it('should skip tools layer when no tools registered', () => {
      const toolRegistry = createToolRegistry([]);
      const profile = createMockProfile({
        toolRegistry,
      });
      const context = createMockContext();

      const result = buildSystemPrompt(profile, context);

      expect(result).not.toContain('# Available Tools');
    });
  });
});
