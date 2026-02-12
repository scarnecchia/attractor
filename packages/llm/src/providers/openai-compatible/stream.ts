import type { SSEEvent } from '../../utils/sse.js';
import type { StreamEvent, FinishReason } from '../../types/index.js';
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
  const toolCallMap = new Map<string, ToolCallState>();

  for await (const event of sseStream) {
    if (!event.data || event.data === '[DONE]') {
      // End of stream
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }

    // Extract model and id from first chunk if not set
    if (!streamStartEmitted) {
      const modelStr = (data['model'] as string) || '';
      const idStr = (data['id'] as string) || '';
      if (modelStr) {
        model = modelStr;
      }
      if (idStr) {
        id = idStr;
      }
    }

    // Get first choice
    const choices = data['choices'] as Array<Record<string, unknown>> | undefined;
    const firstChoice = choices?.[0];

    if (!firstChoice) {
      continue;
    }

    // Emit STREAM_START on first message delta
    const delta = firstChoice['delta'] as Record<string, unknown> | undefined;
    if (!streamStartEmitted && delta) {
      const deltaRole = delta['role'] as string | undefined;
      if (deltaRole === 'assistant') {
        streamStartEmitted = true;
        yield { type: 'STREAM_START', id, model };
      }
    }

    // Text content
    const content = delta?.['content'] as string | undefined;
    if (content) {
      yield { type: 'TEXT_DELTA', text: content };
    }

    // Tool calls
    const toolCalls = delta?.['tool_calls'] as Array<Record<string, unknown>> | undefined;
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const toolCallIndex = (tc['index'] as number) ?? -1;
        const toolCallId = (tc['id'] as string) || '';
        const functionObj = tc['function'] as Record<string, unknown> | undefined;

        if (toolCallIndex >= 0) {
          const toolCallKey = `tc_${toolCallIndex}`;

          // New tool call (has id and name)
          if (toolCallId && functionObj?.['name']) {
            const toolName = (functionObj['name'] as string) || 'unknown';
            currentToolCall = { toolCallId, toolName, argsDelta: '' };
            toolCallMap.set(toolCallKey, currentToolCall);
            yield { type: 'TOOL_CALL_START', toolCallId, toolName };
          }

          // Arguments delta
          const argsDelta = functionObj?.['arguments'] as string | undefined;
          if (argsDelta) {
            const storedToolCall = toolCallMap.get(toolCallKey);
            if (storedToolCall) {
              storedToolCall.argsDelta += argsDelta;
              yield { type: 'TOOL_CALL_DELTA', toolCallId: storedToolCall.toolCallId, argsDelta };
            }
          }
        }
      }
    }

    // Finish reason - emit TOOL_CALL_END and FINISH
    const finishReason = firstChoice['finish_reason'] as string | null | undefined;
    if (finishReason) {
      // Close any open tool calls
      for (const toolCall of toolCallMap.values()) {
        yield { type: 'TOOL_CALL_END', toolCallId: toolCall.toolCallId };
      }
      toolCallMap.clear();

      // Map finish reason
      let mappedFinishReason: FinishReason = 'stop';
      if (finishReason === 'length') {
        mappedFinishReason = 'length';
      } else if (finishReason === 'tool_calls') {
        mappedFinishReason = 'tool_calls';
      } else if (finishReason === 'content_filter') {
        mappedFinishReason = 'content_filter';
      }

      yield { type: 'FINISH', finishReason: mappedFinishReason, usage: emptyUsage() };
    }
  }
}
