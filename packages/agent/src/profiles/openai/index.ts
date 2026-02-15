import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';
import { createOpenAITools } from './tools.js';
import { buildOpenAISystemPrompt } from './prompt.js';

export type OpenAIProfileOptions = {
  readonly model?: string;
};

export function createOpenAIProfile(options?: OpenAIProfileOptions): ProviderProfile {
  const tools = createOpenAITools();
  const registry = createToolRegistry(tools);

  return {
    id: 'openai',
    displayName: 'OpenAI (codex-rs)',
    defaultModel: options?.model ?? 'o4-mini',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildOpenAISystemPrompt,
    projectDocFiles: ['AGENTS.md', '.codex/instructions.md'],
    defaultCommandTimeout: 10_000,
  };
}
