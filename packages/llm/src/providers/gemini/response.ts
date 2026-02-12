import type { LLMResponse, ContentPart } from '../../types/index.js';
import { randomUUID } from 'node:crypto';

export function translateResponse(
  raw: Record<string, unknown>,
  toolCallIdMap: Map<string, string>,
): LLMResponse {
  const id = randomUUID();
  const model = (raw['model'] as string) || 'gemini-unknown';

  const contentParts: Array<ContentPart> = [];

  // Parse candidates[0].content.parts
  const candidates = raw['candidates'] as Array<Record<string, unknown>> | undefined;
  const firstCandidate = candidates?.[0];
  const contentObj = firstCandidate?.['content'] as Record<string, unknown> | undefined;
  const parts = contentObj?.['parts'] as Array<Record<string, unknown>> | undefined;

  if (parts) {
    for (const part of parts) {
      const text = part['text'] as string | undefined;
      const functionCall = part['functionCall'] as Record<string, unknown> | undefined;

      if (text) {
        contentParts.push({
          kind: 'TEXT',
          text,
        });
      } else if (functionCall) {
        const toolCallId = randomUUID();
        const toolName = (functionCall['name'] as string) || 'unknown';

        // Store the mapping for future tool results
        toolCallIdMap.set(toolCallId, toolName);

        contentParts.push({
          kind: 'TOOL_CALL',
          toolCallId,
          toolName,
          args: (functionCall['args'] as Record<string, unknown>) || {},
        });
      }
    }
  }

  // Parse usage
  const usageMetadata = raw['usageMetadata'] as Record<string, unknown> | undefined;
  const usage = {
    inputTokens: (usageMetadata?.['promptTokenCount'] as number) || 0,
    outputTokens: (usageMetadata?.['candidatesTokenCount'] as number) || 0,
    totalTokens: (usageMetadata?.['totalTokenCount'] as number) || 0,
    reasoningTokens: (usageMetadata?.['thoughtsTokenCount'] as number) || 0,
    cacheReadTokens: (usageMetadata?.['cachedContentTokenCount'] as number) || 0,
    cacheWriteTokens: 0,
  };

  // Map finish reason
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' = 'stop';
  const rawFinishReason = firstCandidate?.['finishReason'] as string | undefined;
  if (rawFinishReason === 'MAX_TOKENS') {
    finishReason = 'length';
  } else if (rawFinishReason === 'SAFETY') {
    finishReason = 'content_filter';
  } else if (rawFinishReason === 'STOP') {
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
