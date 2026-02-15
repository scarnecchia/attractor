import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';
import { createAnthropicTools } from './tools.js';
import { buildAnthropicSystemPrompt } from './prompt.js';

export type AnthropicProfileOptions = {
  readonly model?: string;
};

export function createAnthropicProfile(options?: AnthropicProfileOptions): ProviderProfile {
  const tools = createAnthropicTools();
  const registry = createToolRegistry(tools);

  return {
    id: 'anthropic',
    displayName: 'Anthropic (Claude Code)',
    defaultModel: options?.model ?? 'claude-sonnet-4-5-20250929',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildAnthropicSystemPrompt,
    projectDocFiles: ['AGENTS.md', 'CLAUDE.md'],
    defaultCommandTimeout: 120_000,
  };
}
