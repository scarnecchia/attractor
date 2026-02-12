import type { LLMRequest, ContentPart } from '../../types/index.js';

type RequestOutput = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
};

function translateContent(content: ContentPart): Record<string, unknown> | null {
  if (content.kind === 'TEXT') {
    return { type: 'text', text: content.text };
  }
  if (content.kind === 'IMAGE') {
    if (content.data) {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${content.mediaType};base64,${content.data}`,
        },
      };
    }
    if (content.url) {
      return {
        type: 'image_url',
        image_url: { url: content.url },
      };
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
  const url = `${baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const messages: Array<Record<string, unknown>> = [];

  // System message
  if (request.system) {
    messages.push({
      role: 'system',
      content: request.system,
    });
  }

  // User, assistant, and tool messages
  if (request.messages && request.messages.length > 0) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        // Already handled above
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
          if (contentParts.length === 1 && firstPart && firstPart['type'] === 'text') {
            content = (firstPart['text'] as string) || '';
          } else {
            content = contentParts;
          }
        }

        messages.push({
          role: 'user',
          content,
        });
      } else if (message.role === 'assistant') {
        let content: unknown = null;
        let toolCalls: Array<Record<string, unknown>> | undefined;

        if (typeof message.content === 'string') {
          content = message.content;
        } else if (Array.isArray(message.content)) {
          const textParts: Array<string> = [];
          const toolCallList: Array<Record<string, unknown>> = [];

          for (const part of message.content) {
            const p = part as ContentPart;
            if (p.kind === 'TEXT') {
              textParts.push(p.text);
            } else if (p.kind === 'TOOL_CALL') {
              toolCallList.push({
                id: p.toolCallId,
                type: 'function',
                function: {
                  name: p.toolName,
                  arguments: JSON.stringify(p.args),
                },
              });
            }
          }

          if (textParts.length > 0) {
            content = textParts.join('');
          }
          if (toolCallList.length > 0) {
            toolCalls = toolCallList;
          }
        }

        const assistantMessage: Record<string, unknown> = {
          role: 'assistant',
        };
        if (content !== null) {
          assistantMessage['content'] = content;
        }
        if (toolCalls) {
          assistantMessage['tool_calls'] = toolCalls;
        }
        messages.push(assistantMessage);
      } else if (message.role === 'tool') {
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const p = part as ContentPart;
            if (p.kind === 'TOOL_RESULT') {
              messages.push({
                role: 'tool',
                tool_call_id: p.toolCallId,
                content: p.content,
              });
            }
          }
        }
      }
    }
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
  };

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
    body['max_tokens'] = request.maxTokens;
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
  const compatOptions = request.providerOptions?.['openaiCompatible'];
  if (compatOptions) {
    Object.assign(body, compatOptions);
  }

  return { url, headers, body };
}
