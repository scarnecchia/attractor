import type { SSEEvent } from '../../utils/sse.js';
import type { StreamEvent, Usage, FinishReason } from '../../types/index.js';
import { emptyUsage } from '../../types/response.js';

interface ToolCallState {
  toolCallId: string;
  toolName: string;
}

export async function* translateStream(
  sseStream: AsyncIterable<SSEEvent>,
): AsyncIterable<StreamEvent> {
  let streamStartEmitted = false;
  let id = '';
  let model = '';
  let currentToolCall: ToolCallState | null = null;
  let accumulatedUsage = emptyUsage();
  let currentFinishReason: FinishReason = 'stop';

  for await (const event of sseStream) {
    if (!event.data) {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }

    const eventType = data['type'] as string | undefined;

    if (eventType === 'message_start') {
      const message = data['message'] as Record<string, unknown> | undefined;
      if (message) {
        id = (message['id'] as string) || '';
        model = (message['model'] as string) || '';
        streamStartEmitted = true;
        yield { type: 'STREAM_START', id, model };
      }
    } else if (eventType === 'content_block_start') {
      const contentBlock = data['content_block'] as Record<string, unknown> | undefined;
      const blockType = contentBlock?.['type'] as string | undefined;

      if (blockType === 'tool_use') {
        const toolCallId = (contentBlock?.['id'] as string) || '';
        const toolName = (contentBlock?.['name'] as string) || '';
        currentToolCall = { toolCallId, toolName };
        yield { type: 'TOOL_CALL_START', toolCallId, toolName };
      }
    } else if (eventType === 'content_block_delta') {
      const delta = data['delta'] as Record<string, unknown> | undefined;
      if (delta) {
        const deltaType = delta['type'] as string | undefined;

        if (deltaType === 'text_delta') {
          const text = (delta['text'] as string) || '';
          yield { type: 'TEXT_DELTA', text };
        } else if (deltaType === 'input_json_delta') {
          const partialJson = (delta['partial_json'] as string) || '';
          if (currentToolCall) {
            yield { type: 'TOOL_CALL_DELTA', toolCallId: currentToolCall.toolCallId, argsDelta: partialJson };
          }
        } else if (deltaType === 'thinking_delta') {
          const thinking = (delta['thinking'] as string) || '';
          yield { type: 'THINKING_DELTA', text: thinking };
        }
      }
    } else if (eventType === 'content_block_stop') {
      if (currentToolCall) {
        yield { type: 'TOOL_CALL_END', toolCallId: currentToolCall.toolCallId };
        currentToolCall = null;
      }
    } else if (eventType === 'message_delta') {
      const delta = data['delta'] as Record<string, unknown> | undefined;
      if (delta) {
        const stopReason = delta['stop_reason'] as string | undefined;
        if (stopReason === 'max_tokens') {
          currentFinishReason = 'length';
        } else if (stopReason === 'tool_use') {
          currentFinishReason = 'tool_calls';
        } else {
          currentFinishReason = 'stop';
        }
      }

      // Extract usage from message_delta
      const usage = data['usage'] as Record<string, unknown> | undefined;
      if (usage) {
        const inputTokens = (usage['input_tokens'] as number) || 0;
        const outputTokens = (usage['output_tokens'] as number) || 0;
        const cacheReadTokens = (usage['cache_read_input_tokens'] as number) || 0;
        const cacheWriteTokens = (usage['cache_creation_input_tokens'] as number) || 0;

        accumulatedUsage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          reasoningTokens: 0,
          cacheReadTokens,
          cacheWriteTokens,
        };
      }
    } else if (eventType === 'message_stop') {
      yield { type: 'FINISH', finishReason: currentFinishReason, usage: accumulatedUsage };
    }
  }
}
