import type { ToolRegistry, ExecutionEnvironment } from '../types/index.js';

export type PendingToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export type ToolCallResult = {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
};

/**
 * Dispatches tool calls to their executors.
 *
 * Handles:
 * - AC3.1: Successful execution through registry
 * - AC3.2: Unknown tool → error result
 * - AC3.3: Invalid args → error result
 * - AC3.4: Executor throws → error result
 * - AC3.5: Parallel execution when requested
 */
export async function dispatchToolCalls(
  toolCalls: ReadonlyArray<PendingToolCall>,
  registry: ToolRegistry,
  env: ExecutionEnvironment,
  parallel: boolean,
): Promise<ReadonlyArray<ToolCallResult>> {
  if (parallel) {
    return dispatchParallel(toolCalls, registry, env);
  }

  return dispatchSequential(toolCalls, registry, env);
}

async function dispatchParallel(
  toolCalls: ReadonlyArray<PendingToolCall>,
  registry: ToolRegistry,
  env: ExecutionEnvironment,
): Promise<ReadonlyArray<ToolCallResult>> {
  const callsWithIndex = Array.from(toolCalls).map((call, index) => ({
    index,
    call,
  }));

  const promises = callsWithIndex.map((item) => executeToolCall(item.call, registry, env));
  const settled = await Promise.allSettled(promises);

  return callsWithIndex.map((item) => {
    const result = settled[item.index];
    const toolCallId = item.call.toolCallId;

    if (!result) {
      return {
        toolCallId,
        output: 'Tool execution failed: unknown error',
        isError: true,
      };
    }

    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      toolCallId,
      output: `Tool execution failed: ${String(result.reason)}`,
      isError: true,
    };
  });
}

async function dispatchSequential(
  toolCalls: ReadonlyArray<PendingToolCall>,
  registry: ToolRegistry,
  env: ExecutionEnvironment,
): Promise<ReadonlyArray<ToolCallResult>> {
  const results: Array<ToolCallResult> = [];

  for (const call of toolCalls) {
    const result = await executeToolCall(call, registry, env);
    results.push(result);
  }

  return results;
}

async function executeToolCall(
  call: PendingToolCall,
  registry: ToolRegistry,
  env: ExecutionEnvironment,
): Promise<ToolCallResult> {
  const { toolCallId, toolName, args } = call;

  // AC3.2: Look up tool in registry
  const tool = registry.get(toolName);
  if (!tool) {
    return {
      toolCallId,
      output: `Unknown tool: ${toolName}. Available tools: ${registry.definitions().map((d) => d.name).join(', ')}`,
      isError: true,
    };
  }

  // AC3.3: Validate args are proper JSON (already parsed)
  if (!isValidArgs(args)) {
    return {
      toolCallId,
      output: `Invalid tool arguments for ${toolName}: arguments must be a JSON object`,
      isError: true,
    };
  }

  // AC3.4: Execute and catch errors
  try {
    const output = await tool.executor(args, env);
    return {
      toolCallId,
      output,
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      toolCallId,
      output: `Tool error in ${toolName}: ${errorMessage}`,
      isError: true,
    };
  }
}

function isValidArgs(args: unknown): args is Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args);
}
