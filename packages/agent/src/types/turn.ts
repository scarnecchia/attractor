import type { ContentPart } from '@attractor/llm';

export type UserTurn = {
  readonly kind: 'user';
  readonly content: string;
};

export type AssistantTurn = {
  readonly kind: 'assistant';
  readonly content: ReadonlyArray<ContentPart>;
};

export type ToolResultsTurn = {
  readonly kind: 'tool_results';
  readonly results: ReadonlyArray<ToolResultEntry>;
};

export type ToolResultEntry = {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
};

export type SystemTurn = {
  readonly kind: 'system';
  readonly content: string;
};

export type SteeringTurn = {
  readonly kind: 'steering';
  readonly content: string;
};

export type Turn =
  | UserTurn
  | AssistantTurn
  | ToolResultsTurn
  | SystemTurn
  | SteeringTurn;
