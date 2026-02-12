import type {
  LLMRequest,
  LLMResponse,
  StreamEvent,
  ContentPart,
  ToolCall,
  Message,
  Usage,
  FinishReason,
  StepFinish,
} from '../types/index.js';
import { emptyUsage, userMessage } from '../types/index.js';
import type { Client } from '../client/index.js';
import { getDefaultClient } from '../client/default-client.js';
import { resolveImageContent } from '../utils/image.js';
import { retry } from '../utils/retry.js';
import { DEFAULT_RETRY_POLICY } from './constants.js';
import { executeTools } from './tool-execution.js';

export type StreamOptions = LLMRequest & {
  readonly client?: Client;
};

export type StreamResult = {
  readonly stream: AsyncIterable<StreamEvent>;
  response(): Promise<LLMResponse>;
  readonly textStream: AsyncIterable<string>;
};

/**
 * StreamAccumulator accumulates streaming events into a complete response.
 * Tracks text, tool calls, thinking, usage, and finish reason.
 */
export class StreamAccumulator {
  private textParts: Array<string> = [];
  private toolCalls: Map<string, { toolName: string; argsParts: Array<string> }> = new Map();
  private thinkingParts: Array<string> = [];
  private usage: Usage | null = null;
  private finishReason: FinishReason | null = null;
  private id: string = '';
  private model: string = '';

  /**
   * Process a stream event, accumulating its data.
   */
  process(event: StreamEvent): void {
    switch (event.type) {
      case 'STREAM_START':
        this.id = event.id;
        this.model = event.model;
        break;

      case 'TEXT_DELTA':
        this.textParts.push(event.text);
        break;

      case 'TOOL_CALL_START':
        this.toolCalls.set(event.toolCallId, {
          toolName: event.toolName,
          argsParts: [],
        });
        break;

      case 'TOOL_CALL_DELTA':
        {
          const toolCall = this.toolCalls.get(event.toolCallId);
          if (toolCall) {
            toolCall.argsParts.push(event.argsDelta);
          }
        }
        break;

      case 'TOOL_CALL_END':
        // Finalize tool call (already accumulated in TOOL_CALL_DELTA)
        break;

      case 'THINKING_DELTA':
        this.thinkingParts.push(event.text);
        break;

      case 'FINISH':
        this.finishReason = event.finishReason;
        this.usage = event.usage;
        break;

      case 'STEP_FINISH':
        // Step finish is synthetic, used in streaming tool loops
        // Update usage and finish reason for intermediate steps
        this.finishReason = event.finishReason;
        this.usage = event.usage;
        break;
    }
  }

  /**
   * Get accumulated tool calls.
   */
  getToolCalls(): Array<ToolCall> {
    const toolCalls: Array<ToolCall> = [];
    for (const [toolCallId, toolCall] of this.toolCalls) {
      let args: Record<string, unknown> = {};
      const argsJson = toolCall.argsParts.join('');
      if (argsJson) {
        try {
          args = JSON.parse(argsJson) as Record<string, unknown>;
        } catch {
          // If JSON parsing fails, keep empty args
        }
      }
      toolCalls.push({
        toolCallId,
        toolName: toolCall.toolName,
        args,
      });
    }
    return toolCalls;
  }

  /**
   * Build a Response object from accumulated events.
   * Equivalent to what complete() would return.
   */
  toResponse(): LLMResponse {
    const content: Array<ContentPart> = [];

    // Add text content if any
    if (this.textParts.length > 0) {
      content.push({
        kind: 'TEXT',
        text: this.textParts.join(''),
      });
    }

    // Add thinking content if any
    if (this.thinkingParts.length > 0) {
      content.push({
        kind: 'THINKING',
        text: this.thinkingParts.join(''),
        signature: null,
      });
    }

    // Add tool calls if any
    for (const [toolCallId, toolCall] of this.toolCalls) {
      let args: Record<string, unknown> = {};
      const argsJson = toolCall.argsParts.join('');
      if (argsJson) {
        try {
          args = JSON.parse(argsJson) as Record<string, unknown>;
        } catch {
          // If JSON parsing fails, keep empty args
        }
      }

      content.push({
        kind: 'TOOL_CALL',
        toolCallId,
        toolName: toolCall.toolName,
        args,
      });
    }

    return {
      id: this.id,
      model: this.model,
      content,
      finishReason: this.finishReason ?? 'stop',
      usage: this.usage ?? emptyUsage(),
      rateLimitInfo: null,
      warnings: [],
      steps: [],
      providerMetadata: {},
    };
  }
}

/**
 * Stream from the LLM with automatic tool execution.
 * Yields StreamEvent objects. Use response() to get final Response.
 *
 * Design:
 * - The main stream (from createMainStream) populates eventBuffer as events flow
 * - Both stream and textStream consume the same generator instance
 * - Only one should be consumed - attempting to consume both would be redundant
 * - response() waits for the stream to complete, then builds response from buffer
 * - If neither stream nor textStream are consumed, response() will trigger consumption
 */
export function stream(options: StreamOptions): StreamResult {
  const client = options.client ?? getDefaultClient();

  // Buffer all events for response() to use
  const eventBuffer: Array<StreamEvent> = [];

  // Track consumption
  let consumptionStarted = false;
  let consumptionPromise: Promise<void> | null = null;

  async function* createMainStream(): AsyncGenerator<StreamEvent> {
    // Input validation
    if (options.prompt && options.messages) {
      throw new Error('Cannot specify both prompt and messages');
    }

    // Standardize input to messages format
    let messages = options.messages ?? [];
    if (options.prompt) {
      messages = [userMessage(options.prompt)];
    }

    // Prepend system message if provided
    if (options.system) {
      messages = [{ role: 'system', content: options.system }, ...messages];
    }

    // Resolve image paths to base64 data
    const resolvedMessages = await Promise.all(
      messages.map(async (message) => {
        if (typeof message.content === 'string') {
          return message;
        }

        const resolvedContent = await Promise.all(
          message.content.map((part) => resolveImageContent(part)),
        );

        return {
          ...message,
          content: resolvedContent,
        };
      }),
    );

    // Tool execution loop
    let currentMessages = resolvedMessages;
    let roundCount = 0;
    const maxToolRounds = options.maxToolRounds ?? 10;

    while (true) {
      // Build the request for this step
      const request: LLMRequest = {
        model: options.model,
        provider: options.provider,
        messages: currentMessages,
        tools: options.tools,
        toolChoice: options.toolChoice,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        topP: options.topP,
        stopSequences: options.stopSequences,
        responseFormat: options.responseFormat,
        timeout: options.timeout,
        signal: options.signal,
        providerOptions: options.providerOptions,
      };

      // Stream events with accumulation
      const accumulator = new StreamAccumulator();

      // Retry only the stream creation (client.stream call), not the iteration
      const streamGenerator = await retry(
        () => Promise.resolve(client.stream(request)),
        { policy: DEFAULT_RETRY_POLICY },
      );

      // Iterate through stream events
      for await (const event of streamGenerator) {
        accumulator.process(event);
        eventBuffer.push(event);
        yield event;
      }

      // Get tool calls from accumulator
      const toolCalls = accumulator.getToolCalls();

      // Check if we should execute tools
      const hasActiveTool = options.tools?.some((t) => t.execute);
      const shouldExecuteTools =
        toolCalls.length > 0 &&
        options.tools &&
        options.tools.length > 0 &&
        maxToolRounds > 0 &&
        roundCount < maxToolRounds &&
        hasActiveTool;

      if (shouldExecuteTools) {
        // Execute tools
        const toolResults = await executeTools(toolCalls, options.tools!);

        // Get current response before continuing
        const currentResponse = accumulator.toResponse();

        // Yield STEP_FINISH synthetic event
        const stepFinishEvent: StepFinish = {
          type: 'STEP_FINISH',
          finishReason: currentResponse.finishReason,
          usage: currentResponse.usage,
        };
        eventBuffer.push(stepFinishEvent);
        yield stepFinishEvent;

        // Append assistant message with tool calls and tool result messages
        const toolCallParts: Array<ContentPart> = toolCalls.map((tc) => ({
          kind: 'TOOL_CALL' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        }));

        const assistantMsg: Message = {
          role: 'assistant',
          content: toolCallParts,
        };

        const toolResultMsgs: Array<Message> = toolResults.map((tr) => ({
          role: 'tool',
          content: [
            {
              kind: 'TOOL_RESULT' as const,
              toolCallId: tr.toolCallId,
              content: tr.content,
              isError: tr.isError,
            },
          ],
        }));

        currentMessages = [
          ...currentMessages,
          assistantMsg,
          ...toolResultMsgs,
        ];

        roundCount++;
        continue;
      }

      // No more tool loops, we're done
      break;
    }
  }

  // Create the main stream generator instance (can only be consumed once)
  const mainStream = createMainStream();

  // Helper to ensure main stream is fully consumed
  const ensureMainStreamConsumed = async (): Promise<void> => {
    if (!consumptionPromise) {
      consumptionPromise = (async () => {
        consumptionStarted = true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of mainStream) {
          // Consume all events - they populate eventBuffer
        }
      })();
    }
    await consumptionPromise;
  };

  // Create two separate async generators that delegate to the same mainStream
  // Users should consume EITHER stream OR textStream, not both
  async function* streamIterator(): AsyncGenerator<StreamEvent> {
    consumptionStarted = true;
    for await (const event of mainStream) {
      yield event;
    }
  }

  async function* textStreamIterator(): AsyncIterable<string> {
    consumptionStarted = true;
    for await (const event of mainStream) {
      if (event.type === 'TEXT_DELTA') {
        yield event.text;
      }
    }
  }

  // response() waits for main stream to complete, then builds response from buffer
  const getResponse = async (): Promise<LLMResponse> => {
    await ensureMainStreamConsumed();

    // Build response from buffered events
    const accumulator = new StreamAccumulator();
    for (const event of eventBuffer) {
      accumulator.process(event);
    }
    return accumulator.toResponse();
  };

  return {
    stream: streamIterator(),
    response: getResponse,
    textStream: textStreamIterator(),
  };
}

