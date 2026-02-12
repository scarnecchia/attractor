import type { LLMRequest, LLMResponse, Usage } from '../types/index.js';
import { NoObjectGeneratedError } from '../types/index.js';
import type { Client } from '../client/index.js';
import { getDefaultClient } from '../client/default-client.js';
import { generate } from './generate.js';
import { wrapSchemaForOpenAI, createExtractionTool, validateJsonSchema } from '../utils/json-schema.js';

export type GenerateObjectOptions = LLMRequest & {
  readonly client?: Client;
  readonly schema: Record<string, unknown>;
  readonly schemaName?: string;
};

export type GenerateObjectResult<T> = {
  readonly object: T;
  readonly response: LLMResponse;
  readonly usage: Usage;
};

async function generateObject<T>(options: GenerateObjectOptions): Promise<GenerateObjectResult<T>> {
  const client = options.client ?? getDefaultClient();
  const schema = options.schema;
  const schemaName = options.schemaName ?? 'GeneratedObject';

  // Validate schema
  if (!validateJsonSchema(schema)) {
    throw new NoObjectGeneratedError('Invalid schema: missing "type" property', schema);
  }

  // Resolve provider name
  const providerName = client.resolveProviderName(options);

  // Build request based on provider strategy
  let request: LLMRequest = {
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

  if (providerName === 'openai' || providerName === 'openai-compatible') {
    // OpenAI/OpenAI-compatible: use native json_schema
    const responseFormat = wrapSchemaForOpenAI(schema, schemaName);
    request = {
      ...request,
      responseFormat: responseFormat as LLMRequest['responseFormat'],
    };
  } else if (providerName === 'gemini') {
    // Gemini: use responseSchema in providerOptions
    const geminiOptions = (options.providerOptions?.['gemini'] ?? {}) as Record<string, unknown>;
    const generationConfig = (geminiOptions['generationConfig'] ?? {}) as Record<string, unknown>;

    request = {
      ...request,
      providerOptions: {
        ...options.providerOptions,
        gemini: {
          ...geminiOptions,
          generationConfig: {
            ...generationConfig,
            responseSchema: schema,
            responseMimeType: 'application/json',
          },
        },
      },
    };
  } else if (providerName === 'anthropic') {
    // Anthropic: use tool-based extraction
    const existingTools = options.tools ?? [];
    const extractTool = createExtractionTool(schema);

    request = {
      ...request,
      tools: [...existingTools, extractTool],
      toolChoice: {
        mode: 'named',
        toolName: '__extract',
      },
    };
  }

  // Call generate() to get the response
  const generateResult = await generate({
    ...request,
    client,
  });

  // Parse the output based on provider strategy
  let parsedObject: T;

  if (providerName === 'openai' || providerName === 'openai-compatible' || providerName === 'gemini') {
    // Text-based: parse response text as JSON
    const text = generateResult.text;

    if (!text) {
      throw new NoObjectGeneratedError('No text in response', generateResult.response);
    }

    try {
      parsedObject = JSON.parse(text) as T;
    } catch (error) {
      throw new NoObjectGeneratedError(
        `Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
        text,
        error instanceof Error ? error : undefined,
      );
    }
  } else if (providerName === 'anthropic') {
    // Tool-based: extract from tool call arguments
    const toolCalls = generateResult.toolCalls;
    const extractToolCall = toolCalls.find((tc) => tc.toolName === '__extract');

    if (!extractToolCall) {
      throw new NoObjectGeneratedError('No __extract tool call in response', generateResult.response);
    }

    parsedObject = extractToolCall.args as T;
  } else {
    throw new NoObjectGeneratedError(`Unknown provider: ${providerName}`, generateResult.response);
  }

  // Validate that required fields are present
  if (typeof schema === 'object' && schema !== null) {
    const requiredFields = schema['required'];
    if (Array.isArray(requiredFields)) {
      for (const field of requiredFields) {
        if (!(field in (parsedObject as Record<string, unknown>))) {
          throw new NoObjectGeneratedError(
            `Required field missing: ${String(field)}`,
            parsedObject,
          );
        }
      }
    }
  }

  return {
    object: parsedObject,
    response: generateResult.response,
    usage: generateResult.totalUsage,
  };
}

export { generateObject };
