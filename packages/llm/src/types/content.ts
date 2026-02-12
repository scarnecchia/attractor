export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'developer';

export type ContentKind =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'THINKING'
  | 'REDACTED_THINKING';

export type TextData = {
  readonly kind: 'TEXT';
  readonly text: string;
};

export type ImageData = {
  readonly kind: 'IMAGE';
  readonly data: string | null;
  readonly url: string | null;
  readonly mediaType: string;
};

export type AudioData = {
  readonly kind: 'AUDIO';
  readonly data: string;
  readonly mediaType: string;
};

export type DocumentData = {
  readonly kind: 'DOCUMENT';
  readonly data: string;
  readonly mediaType: string;
};

export type ThinkingData = {
  readonly kind: 'THINKING';
  readonly text: string;
  readonly signature: string | null;
};

export type RedactedThinkingData = {
  readonly kind: 'REDACTED_THINKING';
  readonly data: string;
};

export type ToolCallData = {
  readonly kind: 'TOOL_CALL';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export type ToolResultData = {
  readonly kind: 'TOOL_RESULT';
  readonly toolCallId: string;
  readonly content: string;
  readonly isError: boolean;
};

export type ContentPart =
  | TextData
  | ImageData
  | AudioData
  | DocumentData
  | ThinkingData
  | RedactedThinkingData
  | ToolCallData
  | ToolResultData;
