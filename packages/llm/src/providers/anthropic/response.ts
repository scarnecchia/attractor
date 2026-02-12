import type { LLMResponse, ContentPart, FinishReason } from '../../types/index.js';
import { emptyUsage } from '../../types/response.js';

export function translateResponse(raw: Record<string, unknown>): LLMResponse {
  const id = (raw['id'] as string) || '';
  const model = (raw['model'] as string) || '';

  // Extract content from content array
  const content: Array<ContentPart> = [];
  const rawContent = raw['content'] as Array<Record<string, unknown>> | undefined;
  if (rawContent && Array.isArray(rawContent)) {
    for (const item of rawContent) {
      const type = item['type'] as string | undefined;
      if (type === 'text') {
        content.push({
          kind: 'TEXT',
          text: (item['text'] as string) || '',
        });
      } else if (type === 'tool_use') {
        content.push({
          kind: 'TOOL_CALL',
          toolCallId: (item['id'] as string) || '',
          toolName: (item['name'] as string) || '',
          args: (item['input'] as Record<string, unknown>) || {},
        });
      } else if (type === 'thinking') {
        content.push({
          kind: 'THINKING',
          text: (item['thinking'] as string) || '',
          signature: (item['signature'] as string) || null,
        });
      } else if (type === 'redacted_thinking') {
        content.push({
          kind: 'REDACTED_THINKING',
          data: (item['data'] as string) || '',
        });
      }
    }
  }

  // Extract usage
  let usage = emptyUsage();
  const rawUsage = raw['usage'] as Record<string, unknown> | undefined;
  if (rawUsage) {
    const inputTokens = (rawUsage['input_tokens'] as number) || 0;
    const outputTokens = (rawUsage['output_tokens'] as number) || 0;
    const cacheReadTokens = (rawUsage['cache_read_input_tokens'] as number) || 0;
    const cacheWriteTokens = (rawUsage['cache_creation_input_tokens'] as number) || 0;

    usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens: 0,
      cacheReadTokens,
      cacheWriteTokens,
    };
  }

  // Map finish reason
  const stopReason = raw['stop_reason'] as string | undefined;
  let finishReason: FinishReason = 'stop';
  if (stopReason === 'max_tokens') {
    finishReason = 'length';
  } else if (stopReason === 'tool_use') {
    finishReason = 'tool_calls';
  }

  return {
    id,
    model,
    content,
    finishReason,
    usage,
    rateLimitInfo: null,
    warnings: [],
    steps: [],
    providerMetadata: {},
  };
}
