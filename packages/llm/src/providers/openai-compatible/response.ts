import type { LLMResponse, FinishReason, ContentPart } from '../../types/index.js';

export function translateResponse(raw: Record<string, unknown>): LLMResponse {
  const id = (raw['id'] as string) || '';
  const model = (raw['model'] as string) || '';

  const contentParts: Array<ContentPart> = [];

  // Extract first choice's message
  const choices = raw['choices'] as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  const message = firstChoice?.['message'] as Record<string, unknown> | undefined;

  // Text content
  const messageContent = message?.['content'] as string | undefined;
  if (messageContent) {
    contentParts.push({
      kind: 'TEXT',
      text: messageContent,
    });
  }

  // Tool calls
  const toolCalls = message?.['tool_calls'] as Array<Record<string, unknown>> | undefined;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const toolCallId = (tc['id'] as string) || '';
      const functionObj = tc['function'] as Record<string, unknown> | undefined;
      const toolName = (functionObj?.['name'] as string) || 'unknown';
      const argsStr = (functionObj?.['arguments'] as string) || '{}';

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        // Invalid JSON, keep empty object
      }

      contentParts.push({
        kind: 'TOOL_CALL',
        toolCallId,
        toolName,
        args,
      });
    }
  }

  // Usage
  const rawUsage = raw['usage'] as Record<string, unknown> | undefined;
  const usage = {
    inputTokens: (rawUsage?.['prompt_tokens'] as number) || 0,
    outputTokens: (rawUsage?.['completion_tokens'] as number) || 0,
    totalTokens: (rawUsage?.['total_tokens'] as number) || 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Finish reason
  let finishReason: FinishReason = 'stop';
  const rawFinishReason = firstChoice?.['finish_reason'] as string | undefined;
  if (rawFinishReason === 'length') {
    finishReason = 'length';
  } else if (rawFinishReason === 'tool_calls') {
    finishReason = 'tool_calls';
  } else if (rawFinishReason === 'content_filter') {
    finishReason = 'content_filter';
  } else if (rawFinishReason === 'stop') {
    finishReason = 'stop';
  }

  return {
    id,
    model,
    content: contentParts,
    finishReason,
    usage,
    rateLimitInfo: null,
    warnings: [],
    steps: [],
    providerMetadata: {},
  };
}
