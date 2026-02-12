import type { SSEEvent } from '../../utils/sse.js';
import type { StreamEvent } from '../../types/index.js';
import { randomUUID } from 'node:crypto';

export async function* translateStream(
  sseStream: AsyncIterable<SSEEvent>,
  toolCallIdMap: Map<string, string>,
): AsyncIterable<StreamEvent> {
  let streamStartEmitted = false;
  let streamId = '';
  let streamModel = '';
  let hasToolCalls = false;
  let accumulatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  for await (const event of sseStream) {
    if (event.data === '[DONE]' || !event.data) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Emit STREAM_START on first event
    if (!streamStartEmitted) {
      streamStartEmitted = true;
      streamId = randomUUID();
      streamModel = (parsed['model'] as string) || 'gemini-unknown';

      yield {
        type: 'STREAM_START',
        id: streamId,
        model: streamModel,
      };
    }

    // Parse candidates
    const candidates = parsed['candidates'] as Array<Record<string, unknown>> | undefined;
    const firstCandidate = candidates?.[0];

    if (firstCandidate) {
      const contentObj = firstCandidate['content'] as Record<string, unknown> | undefined;
      const parts = contentObj?.['parts'] as Array<Record<string, unknown>> | undefined;

      if (parts) {
        for (const part of parts) {
          const text = part['text'] as string | undefined;
          const functionCall = part['functionCall'] as Record<string, unknown> | undefined;

          if (text) {
            yield {
              type: 'TEXT_DELTA',
              text,
            };
          } else if (functionCall) {
            hasToolCalls = true;
            const toolCallId = randomUUID();
            const toolName = (functionCall['name'] as string) || 'unknown';

            // Store the mapping for future tool results
            toolCallIdMap.set(toolCallId, toolName);

            yield {
              type: 'TOOL_CALL_START',
              toolCallId,
              toolName,
            };

            yield {
              type: 'TOOL_CALL_END',
              toolCallId,
            };
          }
        }
      }

      // Extract usage from finishReason presence (final chunk)
      if (firstCandidate['finishReason']) {
        const usageMetadata = parsed['usageMetadata'] as Record<string, unknown> | undefined;

        if (usageMetadata) {
          accumulatedUsage = {
            inputTokens: (usageMetadata['promptTokenCount'] as number) || 0,
            outputTokens: (usageMetadata['candidatesTokenCount'] as number) || 0,
            totalTokens: (usageMetadata['totalTokenCount'] as number) || 0,
            reasoningTokens: (usageMetadata['thoughtsTokenCount'] as number) || 0,
            cacheReadTokens: (usageMetadata['cachedContentTokenCount'] as number) || 0,
            cacheWriteTokens: 0,
          };
        }

        // Map finish reason
        let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' = 'stop';
        const rawFinishReason = firstCandidate['finishReason'] as string | undefined;
        if (rawFinishReason === 'MAX_TOKENS') {
          finishReason = 'length';
        } else if (rawFinishReason === 'SAFETY') {
          finishReason = 'content_filter';
        } else if (rawFinishReason === 'STOP') {
          finishReason = 'stop';
        }

        // Check if tool calls were generated
        if (hasToolCalls) {
          finishReason = 'tool_calls';
        }

        yield {
          type: 'FINISH',
          finishReason,
          usage: accumulatedUsage,
        };
      }
    }
  }
}
