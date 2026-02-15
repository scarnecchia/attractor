import type { LLMRequest } from '../../types/index.js';

export type TranslateRequestResult = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly toolCallIdMap: Map<string, string>;
};

function buildToolCallIdMap(request: Readonly<LLMRequest>): Map<string, string> {
  const map = new Map<string, string>();

  if (request.messages) {
    for (const message of request.messages) {
      if (message.content) {
        for (const part of message.content) {
          const p = part as Record<string, unknown>;
          if (p['kind'] === 'TOOL_CALL') {
            const toolCallId = p['toolCallId'] as string | undefined;
            const toolName = p['toolName'] as string | undefined;
            if (toolCallId && toolName) {
              map.set(toolCallId, toolName);
            }
          }
        }
      }
    }
  }

  return map;
}

export function translateRequest(
  request: Readonly<LLMRequest>,
  apiKey: string,
  baseUrl: string,
  streaming: boolean,
): TranslateRequestResult {
  const model = request.model;
  const modelsUrl = `${baseUrl}/v1beta/models`;

  let url: string;
  if (streaming) {
    url = `${modelsUrl}/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
  } else {
    url = `${modelsUrl}/${model}:generateContent?key=${apiKey}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const body: Record<string, unknown> = {};

  // System instruction
  if (request.system) {
    body['systemInstruction'] = {
      role: 'user',
      parts: [{ text: request.system }],
    };
  }

  // Build tool call ID map from messages
  const toolCallIdMap = buildToolCallIdMap(request);

  // Messages
  if (request.messages && request.messages.length > 0) {
    const contents: Array<Record<string, unknown>> = [];

    for (const message of request.messages) {
      if (message.role === 'system') {
        continue;
      }

      const role = message.role === 'assistant' ? 'model' : 'user';
      const parts: Array<Record<string, unknown>> = [];

      if (message.content) {
        for (const part of message.content) {
          const p = part as Record<string, unknown>;
          const kind = p['kind'] as string | undefined;

          if (kind === 'TEXT') {
            const text = p['text'] as string | undefined;
            if (text) {
              parts.push({ text });
            }
          } else if (kind === 'IMAGE') {
            const data = p['data'] as string | null | undefined;
            const url = p['url'] as string | null | undefined;
            const mediaType = p['mediaType'] as string | undefined;

            if (data && mediaType) {
              parts.push({
                inlineData: {
                  mimeType: mediaType,
                  data,
                },
              });
            } else if (url && mediaType) {
              parts.push({
                fileData: {
                  mimeType: mediaType,
                  fileUri: url,
                },
              });
            }
          } else if (kind === 'TOOL_RESULT') {
            const toolCallId = p['toolCallId'] as string | undefined;
            const content = p['content'] as string | undefined;
            // For tool results, we need to know the tool name
            // In a real scenario, this should come from the request context or tool call tracking
            // For now, if we don't have it in the map, skip (this shouldn't happen in normal flow)
            if (toolCallId && content) {
              const toolName = toolCallIdMap.get(toolCallId);
              // If we don't have a mapping yet, we might need to infer it differently
              // For now, we'll just skip tool results without a known mapping
              if (toolName) {
                parts.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      result: content,
                    },
                  },
                });
              }
            }
          } else if (kind === 'TOOL_CALL') {
            // Skip tool calls in messages; they don't appear as parts in Gemini API
            // But we've already tracked them in the map above
            continue;
          } else if (kind === 'AUDIO') {
            // Silently skip AUDIO - not natively supported by Gemini
          } else if (kind === 'DOCUMENT') {
            // Silently skip DOCUMENT - not natively supported by Gemini
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    if (contents.length > 0) {
      body['contents'] = contents;
    }
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    body['tools'] = [
      {
        function_declarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters,
        })),
      },
    ];
  }

  // Tool choice
  if (request.toolChoice) {
    body['toolConfig'] = {};
    const toolConfig = body['toolConfig'] as Record<string, unknown>;
    const tc = request.toolChoice as Record<string, unknown>;

    if ('mode' in tc && tc['mode'] === 'auto') {
      toolConfig['functionCallingConfig'] = { mode: 'AUTO' };
    } else if ('mode' in tc && tc['mode'] === 'none') {
      toolConfig['functionCallingConfig'] = { mode: 'NONE' };
    } else if ('mode' in tc && tc['mode'] === 'required') {
      toolConfig['functionCallingConfig'] = { mode: 'ANY' };
    } else if ('mode' in tc && tc['mode'] === 'named' && 'toolName' in tc) {
      toolConfig['functionCallingConfig'] = {
        mode: 'ANY',
        allowedFunctionNames: [tc['toolName']],
      };
    }
  }

  // Generation config
  const generationConfig: Record<string, unknown> = {};

  if (request.maxTokens !== undefined) {
    generationConfig['maxOutputTokens'] = request.maxTokens;
  }

  if (request.temperature !== undefined) {
    generationConfig['temperature'] = request.temperature;
  }

  if (request.topP !== undefined) {
    generationConfig['topP'] = request.topP;
  }

  if (request.stopSequences && request.stopSequences.length > 0) {
    generationConfig['stopSequences'] = request.stopSequences;
  }

  // Reasoning effort → Gemini thinking config
  if (request.reasoningEffort) {
    const budgetMap: Record<string, number> = {
      low: 1024,
      medium: 4096,
      high: 16384,
    };
    const budget = budgetMap[request.reasoningEffort];
    if (budget !== undefined) {
      generationConfig['thinkingConfig'] = {
        thinkingBudget: budget,
      };
    }
  }

  if (Object.keys(generationConfig).length > 0) {
    body['generationConfig'] = generationConfig;
  }

  // Provider options
  const providerOpts = request.providerOptions as Record<string, unknown> | undefined;
  if (providerOpts?.['gemini']) {
    const geminiOptions = providerOpts['gemini'] as Record<string, unknown>;
    Object.assign(body, geminiOptions);
  }

  return {
    url,
    headers,
    body,
    toolCallIdMap,
  };
}
