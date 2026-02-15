import type { Message } from './message.js';
import type { Tool, ToolChoice } from './tool.js';
import type { TimeoutConfig, ResponseFormat } from './config.js';

export type LLMRequest = {
  readonly model: string;
  readonly provider?: string;
  readonly messages?: ReadonlyArray<Message>;
  readonly prompt?: string;
  readonly system?: string;
  readonly tools?: ReadonlyArray<Tool>;
  readonly toolChoice?: ToolChoice;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stopSequences?: ReadonlyArray<string>;
  readonly responseFormat?: ResponseFormat;
  readonly timeout?: TimeoutConfig;
  readonly signal?: AbortSignal;
  readonly maxToolRounds?: number;
  readonly providerOptions?: Record<string, Record<string, unknown>>;
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
};
