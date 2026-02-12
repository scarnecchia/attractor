import { parse, STR, OBJ, ARR, NUM, NULL } from 'partial-json';
import type { LLMRequest, StreamEvent } from '../types/index.js';
import { NoObjectGeneratedError } from '../types/index.js';
import type { Client } from '../client/index.js';
import { getDefaultClient } from '../client/default-client.js';

export type StreamObjectOptions = LLMRequest & {
  readonly client?: Client;
  readonly schema: Record<string, unknown>;
  readonly schemaName?: string;
};

export type StreamObjectResult<T> = {
  readonly stream: AsyncIterable<Partial<T>>;
  object(): Promise<T>;
};

export function streamObject<T>(options: StreamObjectOptions): StreamObjectResult<T> {
  const client = options.client ?? getDefaultClient();
  const providerName = client.resolveProviderName(options);

  // Determine if this is a text-based provider (OpenAI, Gemini, OpenAI-compatible)
  // or tool-based provider (Anthropic)
  const isToolBased = providerName === 'anthropic';

  // Track accumulated JSON string
  let accumulatedJson = '';

  // Track the last yielded partial to avoid duplicates
  let lastYieldedPartialJson = '';

  // Track stream completion and final object
  let finalObject: T | null = null;
  let streamError: Error | null = null;

  async function* createObjectStream(): AsyncGenerator<Partial<T>> {
    try {
      // Create request for the streaming API call
      const streamRequest: LLMRequest = {
        model: options.model,
        provider: options.provider,
        messages: options.messages,
        prompt: options.prompt,
        system: options.system,
        tools: options.tools,
        toolChoice: options.toolChoice,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        topP: options.topP,
        stopSequences: options.stopSequences,
        responseFormat: options.responseFormat,
        timeout: options.timeout,
        signal: options.signal,
        maxToolRounds: options.maxToolRounds,
        providerOptions: options.providerOptions,
      };

      // Get stream directly from client
      const eventStream = client.stream(streamRequest);

      // Process events from the stream
      for await (const event of eventStream) {
        processEvent(event);

        // Try to parse what we have so far
        const parsed = tryParsePartial<T>(accumulatedJson);
        if (parsed !== null) {
          const partialJson = JSON.stringify(parsed);
          // Only yield if different from last yielded
          if (partialJson !== lastYieldedPartialJson) {
            lastYieldedPartialJson = partialJson;
            yield parsed;
          }
        }
      }

      // Final validation: parse complete accumulated JSON
      try {
        const finalParsed = JSON.parse(accumulatedJson) as T;
        validateAgainstSchema(finalParsed, options.schema);
        finalObject = finalParsed;
      } catch (error) {
        streamError = new NoObjectGeneratedError(
          'failed to parse final accumulated JSON as valid object matching schema',
          accumulatedJson,
          error instanceof Error ? error : undefined,
        );
      }
    } catch (error) {
      streamError =
        error instanceof NoObjectGeneratedError
          ? error
          : new NoObjectGeneratedError(
              'stream processing failed',
              accumulatedJson,
              error instanceof Error ? error : undefined,
            );
    }
  }

  function processEvent(event: StreamEvent): void {
    if (event.type === 'TEXT_DELTA') {
      // Text-based provider: accumulate TEXT_DELTA
      accumulatedJson += event.text;
    } else if (event.type === 'TOOL_CALL_DELTA') {
      // Tool-based provider: accumulate TOOL_CALL_DELTA argsDelta
      accumulatedJson += event.argsDelta;
    }
  }

  const objectStream = createObjectStream();

  const getObject = async (): Promise<T> => {
    // Ensure stream has been fully consumed
    for await (const _partial of objectStream) {
      // Consume all events
    }

    // Check if we had an error during streaming
    if (streamError) {
      throw streamError;
    }

    // Check if we successfully parsed a final object
    if (finalObject !== null) {
      return finalObject;
    }

    // If we get here, something went wrong
    throw new NoObjectGeneratedError(
      'no valid object generated from stream',
      accumulatedJson,
    );
  };

  return {
    stream: objectStream,
    object: getObject,
  };
}

/**
 * Try to parse accumulated JSON string using partial-json.
 * Returns parsed object if successful, null if still incomplete.
 */
function tryParsePartial<T>(jsonString: string): Partial<T> | null {
  if (!jsonString || jsonString.trim() === '') {
    return null;
  }

  try {
    const parsed = parse(jsonString, STR | OBJ | ARR | NUM | NULL) as Partial<T>;
    // partial-json returns the best guess; only return if it looks like a real object
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that a parsed object satisfies the schema requirements.
 * Checks that all required fields (from schema.required) are present.
 */
function validateAgainstSchema(obj: unknown, schema: Record<string, unknown>): void {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('parsed result is not an object');
  }

  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === 'string' && !(field in obj)) {
        throw new Error(`missing required field: ${field}`);
      }
    }
  }
}
