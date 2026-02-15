import type { ContentPart, TextData, ToolCallData, ThinkingData } from './content.js';
import type { ToolCall, ToolResult } from './tool.js';

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

export function usageAdd(a: Readonly<Usage>, b: Readonly<Usage>): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export type RateLimitInfo = {
  readonly limitRequests?: number;
  readonly limitTokens?: number;
  readonly remainingRequests?: number;
  readonly remainingTokens?: number;
  readonly resetRequests?: string;
  readonly resetTokens?: string;
};

export type Warning = {
  readonly type: string;
  readonly message: string;
};

export type StepResult = {
  readonly response: LLMResponse;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolResults: ReadonlyArray<ToolResult>;
  readonly usage: Usage;
};

export type LLMResponse = {
  readonly id: string;
  readonly model: string;
  readonly content: ReadonlyArray<ContentPart>;
  readonly finishReason: FinishReason;
  readonly usage: Usage;
  readonly rateLimitInfo: RateLimitInfo | null;
  readonly warnings: ReadonlyArray<Warning>;
  readonly steps: ReadonlyArray<StepResult>;
  readonly providerMetadata: Record<string, unknown>;
};

export function responseText(response: Readonly<LLMResponse>): string {
  return response.content
    .filter((part): part is TextData => part.kind === 'TEXT')
    .map((part) => part.text)
    .join('');
}

export type ExtractedToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export function responseToolCalls(response: Readonly<LLMResponse>): ReadonlyArray<ExtractedToolCall> {
  return response.content
    .filter((part): part is ToolCallData => part.kind === 'TOOL_CALL')
    .map((part) => ({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: part.args,
    }));
}

export function responseReasoning(response: Readonly<LLMResponse>): string {
  return response.content
    .filter((part): part is ThinkingData => part.kind === 'THINKING')
    .map((part) => part.text)
    .join('');
}
