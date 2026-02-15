import type { ToolRegistry } from './tool.js';

export type ProfileId = 'openai' | 'anthropic' | 'gemini';

export type ProviderProfile = {
  readonly id: ProfileId;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly toolRegistry: ToolRegistry;
  readonly supportsParallelToolCalls: boolean;
  readonly buildSystemPrompt: (context: SystemPromptContext) => string;
  readonly projectDocFiles: ReadonlyArray<string>;
  readonly defaultCommandTimeout: number;
};

export type SystemPromptContext = {
  readonly platform: string;
  readonly osVersion: string;
  readonly workingDirectory: string;
  readonly gitBranch: string | null;
  readonly gitStatus: string | null;
  readonly gitLog: string | null;
  readonly date: string;
  readonly model: string;
  readonly projectDocs: string;
  readonly userInstruction: string | null;
};
