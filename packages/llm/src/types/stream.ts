import type { FinishReason, Usage } from './response.js';

export type StreamEventType =
  | 'STREAM_START'
  | 'TEXT_DELTA'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_DELTA'
  | 'TOOL_CALL_END'
  | 'THINKING_DELTA'
  | 'STEP_FINISH'
  | 'FINISH';

export type StreamStart = {
  readonly type: 'STREAM_START';
  readonly id: string;
  readonly model: string;
};

export type TextDelta = {
  readonly type: 'TEXT_DELTA';
  readonly text: string;
};

export type ToolCallStart = {
  readonly type: 'TOOL_CALL_START';
  readonly toolCallId: string;
  readonly toolName: string;
};

export type ToolCallDelta = {
  readonly type: 'TOOL_CALL_DELTA';
  readonly toolCallId: string;
  readonly argsDelta: string;
};

export type ToolCallEnd = {
  readonly type: 'TOOL_CALL_END';
  readonly toolCallId: string;
};

export type ThinkingDelta = {
  readonly type: 'THINKING_DELTA';
  readonly text: string;
};

export type StepFinish = {
  readonly type: 'STEP_FINISH';
  readonly finishReason: FinishReason;
  readonly usage: Usage;
};

export type Finish = {
  readonly type: 'FINISH';
  readonly finishReason: FinishReason;
  readonly usage: Usage;
};

export type StreamEvent =
  | StreamStart
  | TextDelta
  | ToolCallStart
  | ToolCallDelta
  | ToolCallEnd
  | ThinkingDelta
  | StepFinish
  | Finish;
