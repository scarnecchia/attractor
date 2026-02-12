import type { ContentPart, Role } from './content.js';

export type Message = {
  readonly role: Role;
  readonly content: ReadonlyArray<ContentPart> | string;
};

export function systemMessage(text: string): Message {
  return {
    role: 'system',
    content: text,
  };
}

export function userMessage(content: string | ReadonlyArray<ContentPart>): Message {
  return {
    role: 'user',
    content,
  };
}

export function assistantMessage(
  content: string | ReadonlyArray<ContentPart>,
): Message {
  return {
    role: 'assistant',
    content,
  };
}

export function toolMessage(
  toolCallId: string,
  content: string,
  isError?: boolean,
): Message {
  return {
    role: 'tool',
    content: [
      {
        kind: 'TOOL_RESULT',
        toolCallId,
        content,
        isError: isError ?? false,
      },
    ],
  };
}
