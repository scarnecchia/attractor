import type {
  LLMRequest,
  LLMResponse,
  StreamEvent,
  ContentPart,
  ToolCall,
  ToolResult,
  Message,
  Usage,
  FinishReason,
  StepFinish,
} from '../types/index.js';
import { emptyUsage, usageAdd, userMessage } from '../types/index.js';
import type { Client } from '../client/index.js';
import { getDefaultClient } from '../client/default-client.js';
import { resolveImageContent } from '../utils/image.js';
import { retry } from '../utils/retry.js';
import type { RetryPolicy } from '../types/config.js';

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
 */
export function stream(options: StreamOptions): StreamResult {
  const client = options.client ?? getDefaultClient();

  // Capture all events in a buffer so they can be accessed by both stream and response()
  const eventBuffer: Array<StreamEvent> = [];
  let streamCreated = false;
  let responsePromiseResolved: Promise<LLMResponse> | null = null;

  async function* createStream(): AsyncGenerator<StreamEvent> {
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

      // Set up retry policy
      const policy: RetryPolicy = {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      };

      // Stream events with accumulation
      const accumulator = new StreamAccumulator();
      const toolCalls: Array<ToolCall> = [];

      // Stream with retry
      for await (const event of retryStream(
        () => client.stream(request),
        { policy },
      )) {
        accumulator.process(event);
        eventBuffer.push(event);

        // Collect tool calls from TOOL_CALL_END events
        if (event.type === 'TOOL_CALL_END') {
          const toolCall = accumulator['toolCalls']?.get(event.toolCallId);
          if (toolCall) {
            let args: Record<string, unknown> = {};
            const argsJson = toolCall.argsParts.join('');
            if (argsJson) {
              try {
                args = JSON.parse(argsJson) as Record<string, unknown>;
              } catch {
                // Keep empty args if parsing fails
              }
            }
            toolCalls.push({
              toolCallId: event.toolCallId,
              toolName: toolCall.toolName,
              args,
            });
          }
        }

        yield event;
      }

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
            } as ContentPart,
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

  // Create the stream
  const streamIterable = createStream();

  // Create text-only stream
  async function* textStream(): AsyncIterable<string> {
    for await (const event of streamIterable) {
      if (event.type === 'TEXT_DELTA') {
        yield event.text;
      }
    }
  }

  const getResponse = async (): Promise<LLMResponse> => {
    if (!responsePromiseResolved) {
      responsePromiseResolved = (async () => {
        // If stream hasn't been consumed yet, consume it first to build event buffer
        if (!streamCreated) {
          streamCreated = true;
          for await (const _event of streamIterable) {
            // just consume
          }
        }

        // Now build response from buffered events
        const accumulator = new StreamAccumulator();
        for (const event of eventBuffer) {
          accumulator.process(event);
        }
        return accumulator.toResponse();
      })();
    }
    return responsePromiseResolved;
  };

  return {
    stream: (() => {
      streamCreated = true;
      return streamIterable;
    })(),
    response: getResponse,
    textStream: textStream(),
  };
}

/**
 * Helper to retry an async iterable stream.
 * Implements retry logic for stream operations.
 */
async function* retryStream<T>(
  generator: () => AsyncIterable<T>,
  options: { readonly policy?: RetryPolicy },
): AsyncIterable<T> {
  const policy = options.policy ?? {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  };

  let lastError: Error | null = null;
  let delay = policy.initialDelayMs;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      for await (const event of generator()) {
        yield event;
      }
      return;
    } catch (error) {
      lastError = error as Error;

      // Check if retryable
      const isRetryable =
        error instanceof Error &&
        (policy.retryableStatusCodes.includes(parseInt(error.message, 10)) ||
          error.name === 'AbortError' ||
          error.message.includes('timeout'));

      if (attempt < policy.maxRetries && isRetryable) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * policy.backoffMultiplier, policy.maxDelayMs);
      } else {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

/**
 * Execute tools in parallel and collect results.
 */
async function executeTools(
  toolCalls: ReadonlyArray<ToolCall>,
  tools: ReadonlyArray<{
    readonly name: string;
    readonly parameters?: Record<string, unknown>;
    readonly execute?: (args: Record<string, unknown>) => Promise<string>;
  }>,
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
