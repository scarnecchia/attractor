import type { LLMRequest, LLMResponse, ContentPart, ToolCall, ToolResult, Message, StepResult, Usage } from '../types/index.js';
import { ValidationError, emptyUsage, usageAdd, userMessage } from '../types/index.js';
import type { Client } from '../client/index.js';
import { getDefaultClient } from '../client/default-client.js';
import { retry } from '../utils/retry.js';
import { resolveImageContent } from '../utils/image.js';
import { DEFAULT_RETRY_POLICY } from './constants.js';
import { executeTools } from './tool-execution.js';

export type GenerateOptions = LLMRequest & {
  readonly client?: Client;
};

export type GenerateResult = {
  readonly response: LLMResponse;
  readonly steps: ReadonlyArray<StepResult>;
  readonly totalUsage: Usage;
  readonly text: string;
  readonly toolCalls: ReadonlyArray<ToolCall>;
};

/**
 * Generate a response from the LLM using the provided options.
 *
 * Handles:
 * - Input standardization (prompt to messages conversion)
 * - Image resolution from file paths
 * - Tool execution loops with retry
 * - Abort signal propagation
 * - Usage accumulation across steps
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const client = options.client ?? getDefaultClient();

  // Input validation: both prompt and messages cannot be set (AC5.3)
  if (options.prompt && options.messages) {
    throw new ValidationError('Cannot specify both prompt and messages');
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
  const steps: Array<StepResult> = [];
  let currentMessages = resolvedMessages;
  let totalUsage = emptyUsage();
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

    // Call client.complete with retry
    const response = await retry(
      () => client.complete(request),
      { policy: DEFAULT_RETRY_POLICY },
    );

    // Extract tool calls and results from response
    const responseToolCalls = extractToolCalls(response.content);
    const responseToolResults: Array<ToolResult> = [];

    // Track this step
    totalUsage = usageAdd(totalUsage, response.usage);

    // Check if we should execute tools
    // Tools should only be executed if they have execute functions (active tools)
    const hasActiveTool = options.tools?.some((t) => t.execute);
    // Count how many tool execution rounds we've done (steps where tools were executed)
    const executedRounds = steps.filter((s) => s.toolCalls.length > 0).length;
    const shouldExecuteTools =
      responseToolCalls.length > 0 &&
      options.tools &&
      options.tools.length > 0 &&
      maxToolRounds > 0 &&
      executedRounds < maxToolRounds &&
      hasActiveTool;

    if (shouldExecuteTools) {
      // Execute tools
      const toolResults = await executeTools(
        responseToolCalls,
        options.tools!,
      );
      responseToolResults.push(...toolResults);

      // Add step tracking
      steps.push({
        response,
        toolCalls: responseToolCalls,
        toolResults: toolResults,
        usage: response.usage,
      });

      // Append assistant message with tool calls and tool result messages
      const toolCallParts: Array<ContentPart> = responseToolCalls.map((tc) => ({
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

      continue;
    }

    // No tool execution (either no tools, passive tools, or max rounds reached)
    steps.push({
      response,
      toolCalls: responseToolCalls,
      toolResults: responseToolResults,
      usage: response.usage,
    });

    // Extract text and tool calls from final response
    const text = extractText(response.content);
    const toolCalls = extractToolCalls(response.content);

    return {
      response,
      steps,
      totalUsage,
      text,
      toolCalls,
    };
  }
}

function extractText(content: ReadonlyArray<ContentPart>): string {
  return content
    .filter((part) => part.kind === 'TEXT')
    .map((part) => {
      if (part.kind === 'TEXT') {
        return part.text;
      }
      return '';
    })
    .join('');
}

function extractToolCalls(content: ReadonlyArray<ContentPart>): Array<ToolCall> {
  return content
    .filter((part) => part.kind === 'TOOL_CALL')
    .map((part) => {
      if (part.kind === 'TOOL_CALL') {
        return {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
        };
      }
      return null;
    })
    .filter((tc): tc is ToolCall => tc !== null);
}

