export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly execute?: (args: Record<string, unknown>) => Promise<string>;
};

export type ToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export type ToolResult = {
  readonly toolCallId: string;
  readonly content: string;
  readonly isError: boolean;
};

export type ToolChoice =
  | { readonly mode: 'auto' }
  | { readonly mode: 'none' }
  | { readonly mode: 'required' }
  | { readonly mode: 'named'; readonly toolName: string };
