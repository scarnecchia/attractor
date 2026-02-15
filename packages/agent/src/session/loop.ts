import type { StreamEvent, LLMRequest, Message, ContentPart } from '@attractor/llm';
import {
  userMessage,
  assistantMessage,
  toolMessage,
  StreamAccumulator,
  AuthenticationError,
  ContextLengthError,
  ProviderError,
  AbortError,
} from '@attractor/llm';
import type { LoopContext } from './session.js';
import type { Turn } from '../types/index.js';
import { dispatchToolCalls, type PendingToolCall, type ToolCallResult } from '../tools/dispatch.js';

export async function processInput(context: LoopContext): Promise<void> {
  let toolRoundsThisInput = 0;
  let totalTurnsThisSession = 0;

  // Count existing turns to know total
  for (const turn of context.history) {
    if (turn.kind === 'assistant') {
      totalTurnsThisSession++;
    }
  }

  while (true) {
    // Check abort signal
    if (context.abortController.signal.aborted) {
      context.eventEmitter.emit({ kind: 'SESSION_END', sessionId: context.sessionId });
      context.eventEmitter.complete();
      return;
    }

    // Drain steering queue and append SteeringTurns to history
    const steeringTurns = context.steeringQueue.drainSteering();
    for (const turn of steeringTurns) {
      context.history.push(turn);
      // Track context usage for steering turn
      context.contextTracker.record(turn.content.length);
    }

    // Build LLMRequest from history
    const messages = historyToMessages(context.history);
    const toolDefinitions = context.profile.toolRegistry.definitions();
    const tools = toolDefinitions.map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    }));

    const request: LLMRequest = {
      model: context.config.model,
      provider: context.config.provider,
      messages,
      tools,
      signal: context.abortController.signal,
    };

    // Stream from LLM
    const accumulator = new StreamAccumulator();

    try {
      try {
        for await (const event of context.client.stream(request)) {
          // Check abort again
          if (context.abortController.signal.aborted) {
            context.eventEmitter.emit({ kind: 'SESSION_END', sessionId: context.sessionId });
            context.eventEmitter.complete();
            return;
          }

          // Map SDK StreamEvent to SessionEvent and emit
          mapAndEmitStreamEvent(event, context);

          // Accumulate the event
          accumulator.process(event);
        }
      } catch (err) {
        if (context.abortController.signal.aborted) {
          context.eventEmitter.emit({ kind: 'SESSION_END', sessionId: context.sessionId });
          context.eventEmitter.complete();
          return;
        }
        throw err;
      }
    } catch (error: unknown) {
      if (error instanceof AbortError) {
        // Already handled by abort signal path (AC1.7 from Phase 4)
        return;
      }

      if (error instanceof AuthenticationError) {
        // AC11.2: Surface immediately, session → CLOSED
        context.eventEmitter.emit({ kind: 'ERROR', error });
        throw error;
      }

      if (error instanceof ContextLengthError) {
        // AC11.3: Emit warning, session → CLOSED
        context.eventEmitter.emit({ kind: 'CONTEXT_WARNING', usagePercent: 1.0 });
        context.eventEmitter.emit({ kind: 'ERROR', error });
        throw error;
      }

      if (error instanceof ProviderError && error.retryable) {
        // Retryable errors (429, 500-503) are handled by @attractor/llm's
        // retry layer in stream()/generate(). If they still surface here,
        // the retry budget was exhausted — treat as fatal.
        context.eventEmitter.emit({ kind: 'ERROR', error });
        throw error;
      }

      // Unknown/unexpected errors → surface and close
      const errorObj = error instanceof Error ? error : new Error(String(error));
      context.eventEmitter.emit({
        kind: 'ERROR',
        error: errorObj,
      });
      throw errorObj;
    }

    // Build AssistantTurn from accumulated response
    const response = accumulator.toResponse();
    const assistantTurn = {
      kind: 'assistant' as const,
      content: response.content,
    };
    context.history.push(assistantTurn);

    // Track context usage for AssistantTurn
    let assistantChars = 0;
    for (const part of assistantTurn.content) {
      if (part.kind === 'TEXT') {
        assistantChars += part.text.length;
      } else if (part.kind === 'TOOL_CALL') {
        assistantChars += JSON.stringify(part).length;
      }
    }
    context.contextTracker.record(assistantChars);

    // Check context window usage
    const usagePercent = context.contextTracker.check();
    if (usagePercent !== null) {
      context.eventEmitter.emit({ kind: 'CONTEXT_WARNING', usagePercent });
    }

    totalTurnsThisSession++;

    // Extract tool calls
    const toolCalls = response.content.filter((part) => part.kind === 'TOOL_CALL');

    // If no tool calls, exit the loop (natural completion)
    if (toolCalls.length === 0) {
      break;
    }

    // Check max_tool_rounds_per_input
    const maxToolRounds = context.config.maxToolRoundsPerInput ?? 10;
    if (toolRoundsThisInput >= maxToolRounds) {
      context.eventEmitter.emit({
        kind: 'TURN_LIMIT',
        reason: 'max_tool_rounds',
      });
      break;
    }

    // Check max_turns across session
    const maxTurns = context.config.maxTurns ?? 100;
    if (totalTurnsThisSession >= maxTurns) {
      context.eventEmitter.emit({
        kind: 'TURN_LIMIT',
        reason: 'max_turns',
      });
      break;
    }

    // Execute tools
    const pendingToolCalls: Array<PendingToolCall> = toolCalls.map((part) => {
      if (part.kind !== 'TOOL_CALL') {
        throw new Error('Invalid tool call');
      }
      return {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
      };
    });

    // Dispatch tool calls
    const results = await dispatchToolCalls(
      pendingToolCalls,
      context.profile.toolRegistry,
      context.environment,
      context.profile.supportsParallelToolCalls,
    );

    // Emit TOOL_CALL_END events with full untruncated output (AC10.3)
    const toolResultEntries: Array<{ toolCallId: string; output: string; isError: boolean }> = [];
    for (const result of results) {
      context.eventEmitter.emit({
        kind: 'TOOL_CALL_END',
        toolCallId: result.toolCallId,
        toolName: pendingToolCalls.find((call) => call.toolCallId === result.toolCallId)?.toolName ?? 'unknown',
        output: result.output,
        isError: result.isError,
      });

      // Record tool call for loop detection before truncating
      const toolCall = pendingToolCalls.find((call) => call.toolCallId === result.toolCallId);
      if (toolCall) {
        const argsHash = hashArgs(toolCall.args);
        context.loopDetector.record(toolCall.toolName, argsHash);
      }

      // Truncate output for LLM
      const maxOutputLength = context.config.toolOutputLimits?.[toolCall?.toolName ?? ''] ?? 2000;
      const truncatedOutput = result.output.substring(0, maxOutputLength);

      toolResultEntries.push({
        toolCallId: result.toolCallId,
        output: truncatedOutput,
        isError: result.isError,
      });
    }

    // Check for loop detection (once per round, not per result)
    const loopWarning = context.loopDetector.check();
    if (loopWarning) {
      context.eventEmitter.emit({
        kind: 'LOOP_DETECTION',
        message: loopWarning,
      });

      // Inject steering turn with warning
      context.steeringQueue.steer(
        `Loop detection: ${loopWarning}. Please adjust your approach or provide more context.`,
      );
    }

    // Append ToolResultsTurn to history
    const toolResultsTurn = {
      kind: 'tool_results' as const,
      results: toolResultEntries,
    };
    context.history.push(toolResultsTurn);

    // Track context usage for ToolResultsTurn
    let toolResultsChars = 0;
    for (const result of toolResultEntries) {
      toolResultsChars += result.output.length;
    }
    context.contextTracker.record(toolResultsChars);

    // Check context window usage again after tool results
    const toolResultsUsagePercent = context.contextTracker.check();
    if (toolResultsUsagePercent !== null) {
      context.eventEmitter.emit({ kind: 'CONTEXT_WARNING', usagePercent: toolResultsUsagePercent });
    }

    toolRoundsThisInput++;
  }
}

function historyToMessages(history: ReadonlyArray<Turn>): ReadonlyArray<Message> {
  const messages: Array<Message> = [];

  for (const turn of history) {
    switch (turn.kind) {
      case 'user':
      case 'steering':
      case 'system':
        messages.push(userMessage(turn.content));
        break;

      case 'assistant':
        messages.push(assistantMessage(turn.content));
        break;

      case 'tool_results':
        for (const result of turn.results) {
          messages.push(toolMessage(result.toolCallId, result.output, result.isError));
        }
        break;
    }
  }

  return messages;
}

function mapAndEmitStreamEvent(event: StreamEvent, context: LoopContext): void {
  switch (event.type) {
    case 'STREAM_START':
      context.eventEmitter.emit({ kind: 'ASSISTANT_TEXT_START' });
      break;

    case 'TEXT_DELTA':
      context.eventEmitter.emit({
        kind: 'ASSISTANT_TEXT_DELTA',
        text: event.text,
      });
      break;

    case 'THINKING_DELTA':
      context.eventEmitter.emit({
        kind: 'THINKING_DELTA',
        text: event.text,
      });
      break;

    case 'TOOL_CALL_START':
      context.eventEmitter.emit({
        kind: 'TOOL_CALL_START',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: {}, // Will be completed by accumulator
      });
      break;

    case 'TOOL_CALL_DELTA':
      // Not emitted directly, accumulated internally
      break;

    case 'TOOL_CALL_END':
      // Not emitted here, emitted after tool execution
      break;

    case 'FINISH':
      context.eventEmitter.emit({ kind: 'ASSISTANT_TEXT_END' });
      break;

    case 'STEP_FINISH':
      // Internal bookkeeping, not emitted
      break;
  }
}

function hashArgs(args: Record<string, unknown>): string {
  // Simple deterministic hash: stringify sorted keys
  const sortedKeys = Object.keys(args).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = args[key];
  }
  return JSON.stringify(sortedObj);
}
