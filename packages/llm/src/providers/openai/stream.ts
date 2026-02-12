import type { SSEEvent } from '../../utils/sse.js';
import type { StreamEvent, Usage, FinishReason } from '../../types/index.js';
import { emptyUsage } from '../../types/response.js';

interface ToolCallState {
  toolCallId: string;
  toolName: string;
  argsDelta: string;
}

export async function* translateStream(
  sseStream: AsyncIterable<SSEEvent>,
): AsyncIterable<StreamEvent> {
  let streamStartEmitted = false;
  let currentToolCall: ToolCallState | null = null;
  let id = '';
  let model = '';

  for await (const event of sseStream) {
    if (!event.data || event.data === '[DONE]') {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }

    const eventType = data['type'] as string | undefined;

    if (eventType === 'response.created') {
      const response = data['response'] as Record<string, unknown> | undefined;
      if (response) {
        id = (response['id'] as string) || '';
        model = (response['model'] as string) || '';
        streamStartEmitted = true;
        yield { type: 'STREAM_START', id, model };
      }
    } else if (eventType === 'response.output_text.delta') {
      const delta = data['delta'] as string | undefined;
      if (delta) {
        yield { type: 'TEXT_DELTA', text: delta };
      }
    } else if (eventType === 'response.function_call_arguments.delta') {
      const delta = data['delta'] as string | undefined;
      if (delta) {
        if (!currentToolCall) {
          // This shouldn't happen - function_call_start should come first
          // But handle gracefully
          currentToolCall = {
            toolCallId: '',
            toolName: '',
            argsDelta: delta,
          };
        } else {
          currentToolCall.argsDelta += delta;
        }
        yield { type: 'TOOL_CALL_DELTA', toolCallId: currentToolCall.toolCallId, argsDelta: delta };
      }
    } else if (eventType === 'response.function_call_start') {
      // Start of a new function call
      const callId = data['call_id'] as string | undefined;
      const functionName = data['name'] as string | undefined;
      if (callId && functionName) {
        currentToolCall = { toolCallId: callId, toolName: functionName, argsDelta: '' };
        yield { type: 'TOOL_CALL_START', toolCallId: callId, toolName: functionName };
      }
    } else if (eventType === 'response.function_call_output') {
      // End of a function call
      if (currentToolCall) {
        yield { type: 'TOOL_CALL_END', toolCallId: currentToolCall.toolCallId };
        currentToolCall = null;
      }
    } else if (eventType === 'response.completed') {
      // Extract usage and finish reason
      const response = data['response'] as Record<string, unknown> | undefined;
      let usage = emptyUsage();

      if (response) {
        const rawUsage = response['usage'] as Record<string, unknown> | undefined;
        if (rawUsage) {
          const inputTokens = (rawUsage['input_tokens'] as number) || 0;
          const outputTokens = (rawUsage['output_tokens'] as number) || 0;
          let cacheReadTokens = 0;

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

        const stopReason = response['stop_reason'] as string | undefined;
        let finishReason: FinishReason = 'stop';
        if (stopReason === 'length') {
          finishReason = 'length';
        } else if (stopReason === 'tool_calls') {
          finishReason = 'tool_calls';
        } else if (stopReason === 'content_filter') {
          finishReason = 'content_filter';
        }

        yield { type: 'FINISH', finishReason, usage };
      }
    }
  }
}
