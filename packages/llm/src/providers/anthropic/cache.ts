export function injectCacheControl(
  body: Record<string, unknown>,
  autoCache: boolean,
): Record<string, unknown> {
  if (!autoCache) {
    return body;
  }

  const result = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

  // Inject cache_control on system array last block
  const system = result.system as Array<Record<string, unknown>> | undefined;
  if (system && Array.isArray(system) && system.length > 0) {
    const lastBlock = system[system.length - 1];
    if (lastBlock) {
      lastBlock.cache_control = { type: 'ephemeral' };
    }
  }

  // Inject cache_control on last tool in tools array
  const tools = result.tools as Array<Record<string, unknown>> | undefined;
  if (tools && Array.isArray(tools) && tools.length > 0) {
    const lastTool = tools[tools.length - 1];
    if (lastTool) {
      lastTool.cache_control = { type: 'ephemeral' };
    }
  }

  // Inject cache_control on last content block of last user message
  const messages = result.messages as Array<Record<string, unknown>> | undefined;
  if (messages && Array.isArray(messages) && messages.length > 0) {
    // Find last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message && message.role === 'user') {
        const content = message.content as Array<Record<string, unknown>> | undefined;
        if (content && Array.isArray(content) && content.length > 0) {
          const lastBlock = content[content.length - 1];
          if (lastBlock) {
            lastBlock.cache_control = { type: 'ephemeral' };
          }
        }
        break;
      }
    }
  }

  return result;
}

export function injectBetaHeaders(
  headers: Record<string, string>,
  hasCacheControl: boolean,
): Record<string, string> {
  if (!hasCacheControl) {
    return headers;
  }

  const result = { ...headers };
  const betaHeader = 'prompt-caching-2024-07-31';

  if (result['anthropic-beta']) {
    result['anthropic-beta'] = `${result['anthropic-beta']}, ${betaHeader}`;
  } else {
    result['anthropic-beta'] = betaHeader;
  }

  return result;
}
