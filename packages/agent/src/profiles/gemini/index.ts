import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';
import { createGeminiTools } from './tools.js';
import { buildGeminiSystemPrompt } from './prompt.js';

export type GeminiProfileOptions = {
  readonly model?: string;
};

export function createGeminiProfile(options?: GeminiProfileOptions): ProviderProfile {
  const tools = createGeminiTools();
  const registry = createToolRegistry(tools);

  return {
    id: 'gemini',
    displayName: 'Gemini (gemini-cli)',
    defaultModel: options?.model ?? 'gemini-2.5-pro',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildGeminiSystemPrompt,
    projectDocFiles: ['AGENTS.md', 'GEMINI.md'],
    defaultCommandTimeout: 10_000,
  };
}
