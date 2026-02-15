import type { StreamEvent, LLMRequest, Message, ContentPart } from '@attractor/llm';
import { userMessage, assistantMessage, toolMessage, StreamAccumulator } from '@attractor/llm';
import type { LoopContext } from './session.js';
import type { Turn } from '../types/index.js';
import { dispatchToolCalls, type PendingToolCall, type ToolCallResult } from '../tools/dispatch.js';

export async function processInput(context: LoopContext): Promise<void> {
  let toolRoundsThisInput = 0;
  let totalTurnsThisSession = 0;

  // Count existing turns to know total
  for (const turn of context.history) {
    if (turn.kind === 'assistant' || turn.kind === 'tool_results') {
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
    let streamError: Error | null = null;

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

    // Build AssistantTurn from accumulated response
    const response = accumulator.toResponse();
    context.history.push({
      kind: 'assistant',
      content: response.content,
    });

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

      // Check for loop detection
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

      // Truncate output for LLM
      const maxOutputLength = context.config.toolOutputLimits?.[toolCall?.toolName ?? ''] ?? 2000;
      const truncatedOutput = result.output.substring(0, maxOutputLength);

      toolResultEntries.push({
        toolCallId: result.toolCallId,
        output: truncatedOutput,
        isError: result.isError,
      });
    }

    // Append ToolResultsTurn to history
    context.history.push({
      kind: 'tool_results',
      results: toolResultEntries,
    });

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
