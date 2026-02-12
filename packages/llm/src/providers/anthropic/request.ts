import type { LLMRequest, ContentPart } from '../../types/index.js';
import { injectCacheControl, injectBetaHeaders } from './cache.js';

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
        type: 'image',
        source: { type: 'base64', media_type: content.mediaType, data: content.data },
      };
    }
    if (content.url) {
      return {
        type: 'image',
        source: { type: 'url', url: content.url },
      };
    }
  }
  if (content.kind === 'TOOL_CALL') {
    return {
      type: 'tool_use',
      id: content.toolCallId,
      name: content.toolName,
      input: content.args,
    };
  }
  if (content.kind === 'THINKING') {
    return {
      type: 'thinking',
      thinking: content.text,
      signature: content.signature,
    };
  }
  if (content.kind === 'REDACTED_THINKING') {
    return {
      type: 'redacted_thinking',
      data: content.data,
    };
  }
  return null;
}

export function translateRequest(
  request: Readonly<LLMRequest>,
  apiKey: string,
): RequestOutput {
  const url = 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens || 4096,
  };

  // System message
  if (request.system) {
    body['system'] = [{ type: 'text', text: request.system }];
  }

  // Messages with alternation enforcement and merging
  const messages: Array<Record<string, unknown>> = [];
  if (request.messages && request.messages.length > 0) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        // Skip system messages - they go in body.system
        continue;
      }

      let currentRole = message.role;
      const contentParts: Array<Record<string, unknown>> = [];

      if (message.role === 'user' || message.role === 'developer') {
        currentRole = 'user';
        if (typeof message.content === 'string') {
          contentParts.push({ type: 'text', text: message.content });
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const translated = translateContent(part as ContentPart);
            if (translated) {
              contentParts.push(translated);
            }
          }
        }
      } else if (message.role === 'assistant') {
        currentRole = 'assistant';
        if (typeof message.content === 'string') {
          contentParts.push({ type: 'text', text: message.content });
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const translated = translateContent(part as ContentPart);
            if (translated) {
              contentParts.push(translated);
            }
          }
        }
      } else if (message.role === 'tool') {
        currentRole = 'user';
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const p = part as ContentPart;
            if (p.kind === 'TOOL_RESULT') {
              contentParts.push({
                type: 'tool_result',
                tool_use_id: p.toolCallId,
                content: p.content,
              });
            }
          }
        }
      }

      if (contentParts.length > 0) {
        // Check if we need to merge with previous message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === currentRole && currentRole === 'user') {
          // Merge with previous user message
          const lastContent = lastMessage.content as Array<Record<string, unknown>>;
          lastContent.push(...contentParts);
        } else {
          // Add as new message
          messages.push({
            role: currentRole,
            content: contentParts,
          });
        }
      }
    }
  }

  if (messages.length > 0) {
    body['messages'] = messages;
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    body['tools'] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  // Tool choice
  if (request.toolChoice) {
    if (request.toolChoice.mode === 'auto') {
      body['tool_choice'] = { type: 'auto' };
    } else if (request.toolChoice.mode === 'required') {
      body['tool_choice'] = { type: 'any' };
    } else if (request.toolChoice.mode === 'named') {
      body['tool_choice'] = {
        type: 'tool',
        name: request.toolChoice.toolName,
      };
    }
  }

  // Token limits and parameters
  if (request.temperature !== undefined) {
    body['temperature'] = request.temperature;
  }
  if (request.topP !== undefined) {
    body['top_p'] = request.topP;
  }
  if (request.stopSequences && request.stopSequences.length > 0) {
    body['stop_sequences'] = request.stopSequences;
  }

  // Provider options escape hatch
  const anthropicOptions = request.providerOptions?.['anthropic'];
  if (anthropicOptions) {
    const { betaHeaders, autoCache, ...rest } = anthropicOptions as Record<string, unknown> & {
      betaHeaders?: Record<string, string>;
      autoCache?: boolean;
    };

    Object.assign(body, rest);

    // Merge beta headers
    if (betaHeaders) {
      for (const [key, value] of Object.entries(betaHeaders)) {
        if (headers['anthropic-beta']) {
          headers['anthropic-beta'] = `${headers['anthropic-beta']}, ${value}`;
        } else {
          headers['anthropic-beta'] = value as string;
        }
      }
    }
  }

  // Cache control injection (default true unless explicitly disabled)
  const autoCache = (request.providerOptions?.['anthropic'] as Record<string, unknown> | undefined)
    ?.autoCache !== false;
  const bodyWithCache = injectCacheControl(body, autoCache);
  const headersWithBeta = injectBetaHeaders(headers, autoCache);

  return {
    url,
    headers: headersWithBeta,
    body: bodyWithCache,
  };
}
