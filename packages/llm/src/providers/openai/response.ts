import type { LLMResponse, ContentPart, FinishReason, Usage } from '../../types/index.js';
import { emptyUsage } from '../../types/response.js';

export function translateResponse(raw: Record<string, unknown>): LLMResponse {
  const id = (raw['id'] as string) || '';
  const model = (raw['model'] as string) || '';

  // Extract content from output
  const content: Array<ContentPart> = [];
  const output = raw['output'] as Array<Record<string, unknown>> | undefined;
  if (output && Array.isArray(output)) {
    for (const item of output) {
      const type = item['type'] as string;
      if (type === 'message') {
        const msgContent = item['content'];
        if (typeof msgContent === 'string') {
          content.push({
            kind: 'TEXT',
            text: msgContent,
          });
        }
      } else if (type === 'function_call') {
        content.push({
          kind: 'TOOL_CALL',
          toolCallId: (item['call_id'] as string) || '',
          toolName: (item['name'] as string) || '',
          args: (item['arguments'] as Record<string, unknown>) || {},
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
    let cacheReadTokens = 0;

    // Check for cache read tokens in prompt_tokens_details
    const promptDetails = rawUsage['prompt_tokens_details'] as Record<string, unknown> | undefined;
    if (promptDetails && typeof promptDetails['cached_tokens'] === 'number') {
      cacheReadTokens = promptDetails['cached_tokens'];
    }

    usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens: (rawUsage['reasoning_tokens'] as number) || 0,
      cacheReadTokens,
      cacheWriteTokens: 0,
    };
  }

  // Map finish reason
  const stopReason = raw['stop_reason'] as string | undefined;
  let finishReason: FinishReason = 'stop';
  if (stopReason === 'length') {
    finishReason = 'length';
  } else if (stopReason === 'tool_calls') {
    finishReason = 'tool_calls';
  } else if (stopReason === 'content_filter') {
    finishReason = 'content_filter';
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
