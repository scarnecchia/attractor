import type { ToolCall, ToolResult, Tool } from '../types/index.js';

/**
 * Execute tools in parallel and collect results.
 *
 * Used by both generate() and stream() for active tool execution.
 * All tool calls are executed concurrently via Promise.allSettled.
 * Tool errors are captured and returned as error results, not thrown.
 */
export async function executeTools(
  toolCalls: ReadonlyArray<ToolCall>,
  tools: ReadonlyArray<Tool>,
): Promise<Array<ToolResult>> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const results = await Promise.allSettled(
    toolCalls.map(async (toolCall) => {
      const tool = toolMap.get(toolCall.toolName);

      if (!tool) {
        return {
          toolCallId: toolCall.toolCallId,
          content: `Unknown tool: ${toolCall.toolName}`,
          isError: true,
        };
      }

      if (!tool.execute) {
        return {
          toolCallId: toolCall.toolCallId,
          content: `Tool ${toolCall.toolName} does not support execution`,
          isError: true,
        };
      }

      try {
        const result = await tool.execute(toolCall.args);
        return {
          toolCallId: toolCall.toolCallId,
          content: result,
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          toolCallId: toolCall.toolCallId,
          content: message,
          isError: true,
        };
      }
    }),
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const toolCall = toolCalls[index];
      return {
        toolCallId: toolCall?.toolCallId ?? '',
        content:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        isError: true,
      };
    }
  });
}
