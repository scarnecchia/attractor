export type EventKind =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'ASSISTANT_TEXT_START'
  | 'ASSISTANT_TEXT_DELTA'
  | 'ASSISTANT_TEXT_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_END'
  | 'THINKING_DELTA'
  | 'TURN_LIMIT'
  | 'LOOP_DETECTION'
  | 'CONTEXT_WARNING'
  | 'ERROR'
  | 'SUBAGENT_EVENT';

export type SessionEvent =
  | { readonly kind: 'SESSION_START'; readonly sessionId: string }
  | { readonly kind: 'SESSION_END'; readonly sessionId: string }
  | { readonly kind: 'ASSISTANT_TEXT_START' }
  | { readonly kind: 'ASSISTANT_TEXT_DELTA'; readonly text: string }
  | { readonly kind: 'ASSISTANT_TEXT_END' }
  | {
      readonly kind: 'TOOL_CALL_START';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly kind: 'TOOL_CALL_END';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly output: string;
      readonly isError: boolean;
    }
  | { readonly kind: 'THINKING_DELTA'; readonly text: string }
  | { readonly kind: 'TURN_LIMIT'; readonly reason: 'max_tool_rounds' | 'max_turns' }
  | { readonly kind: 'LOOP_DETECTION'; readonly message: string }
  | { readonly kind: 'CONTEXT_WARNING'; readonly usagePercent: number }
  | { readonly kind: 'ERROR'; readonly error: Error }
  | { readonly kind: 'SUBAGENT_EVENT'; readonly subagentId: string; readonly event: SessionEvent };
