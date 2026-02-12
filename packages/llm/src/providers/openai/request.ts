import type { LLMRequest, ContentPart } from '../../types/index.js';

type RequestOutput = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
};

function translateContent(content: ContentPart): Record<string, unknown> | null {
  if (content.kind === 'TEXT') {
    return { type: 'input_text', text: content.text };
  }
  if (content.kind === 'IMAGE') {
    if (content.data) {
      return { type: 'input_image', image_url: `data:${content.mediaType};base64,${content.data}` };
    }
    if (content.url) {
      return { type: 'input_image', image_url: content.url };
    }
  }
  return null;
}

export function translateRequest(
  request: Readonly<LLMRequest>,
  apiKey: string,
  baseUrl: string,
  streaming: boolean = false,
): RequestOutput {
  const url = `${baseUrl}/v1/responses`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const body: Record<string, unknown> = {
    model: request.model,
  };

  // System message to instructions
  if (request.system) {
    body['instructions'] = request.system;
  }

  // Messages to input array
  const input: Array<Record<string, unknown>> = [];
  if (request.messages && request.messages.length > 0) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        // System is already handled above
        continue;
      }

      if (message.role === 'user') {
        let content: unknown = '';
        if (typeof message.content === 'string') {
          content = message.content;
        } else if (Array.isArray(message.content)) {
          const contentParts = message.content
            .map((c) => translateContent(c as ContentPart))
            .filter((c): c is Record<string, unknown> => c !== null);

          const firstPart = contentParts[0];
          if (contentParts.length === 1 && firstPart && firstPart['type'] === 'input_text') {
            content = (firstPart['text'] as unknown) || '';
          } else {
            content = contentParts;
          }
        }

        input.push({
          type: 'message',
          role: 'user',
          content,
        });
      } else if (message.role === 'assistant') {
        let content: unknown = '';
        if (typeof message.content === 'string') {
          content = message.content;
        } else if (Array.isArray(message.content)) {
          const contentParts = message.content
            .map((c) => translateContent(c as ContentPart))
            .filter((c): c is Record<string, unknown> => c !== null);

          const firstPart = contentParts[0];
          if (contentParts.length === 1 && firstPart && firstPart['type']?.toString().startsWith('text')) {
            content = (firstPart['text'] as string) || '';
          } else {
            content = contentParts;
          }
        }

        input.push({
          type: 'message',
          role: 'assistant',
          content,
        });
      } else if (message.role === 'tool') {
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const p = part as ContentPart;
            if (p.kind === 'TOOL_RESULT') {
              input.push({
                type: 'function_call_output',
                call_id: p.toolCallId,
                output: p.content,
              });
            }
          }
        }
      }
    }
  }

  if (input.length > 0) {
    body['input'] = input;
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    body['tools'] = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  // Tool choice
  if (request.toolChoice) {
    if (request.toolChoice.mode === 'auto') {
      body['tool_choice'] = 'auto';
    } else if (request.toolChoice.mode === 'none') {
      body['tool_choice'] = 'none';
    } else if (request.toolChoice.mode === 'required') {
      body['tool_choice'] = 'required';
    } else if (request.toolChoice.mode === 'named') {
      body['tool_choice'] = {
        type: 'function',
        function: { name: request.toolChoice.toolName },
      };
    }
  }

  // Token limits and parameters
  if (request.maxTokens !== undefined) {
    body['max_output_tokens'] = request.maxTokens;
  }
  if (request.temperature !== undefined) {
    body['temperature'] = request.temperature;
  }
  if (request.topP !== undefined) {
    body['top_p'] = request.topP;
  }
  if (request.stopSequences && request.stopSequences.length > 0) {
    body['stop'] = request.stopSequences;
  }

  // Streaming flag
  if (streaming) {
    body['stream'] = true;
  }

  // Provider options escape hatch
  const openaiOptions = request.providerOptions?.['openai'];
  if (openaiOptions) {
    Object.assign(body, openaiOptions);
  }

  return { url, headers, body };
}
