import type { Middleware, LLMRequest, LLMResponse, StreamEvent } from '../types/index.js';

export function executeMiddlewareChain(
  middlewares: ReadonlyArray<Middleware>,
  request: LLMRequest,
  handler: (request: LLMRequest) => Promise<LLMResponse> | AsyncIterable<StreamEvent>,
): Promise<LLMResponse> | AsyncIterable<StreamEvent> {
  // Build the chain from the inside out: start with handler as innermost,
  // then wrap each middleware around it in reverse order (so the first-registered
  // middleware executes first for requests, last for responses — onion model)

  let chain: (request: LLMRequest) => Promise<LLMResponse> | AsyncIterable<StreamEvent> = handler;

  // Iterate through middlewares in reverse order to build the onion
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i];
    if (!mw) continue; // Skip if middleware is missing (defensive programming)
    const nextChain = chain;

    chain = (request: LLMRequest) => mw(request, nextChain);
  }

  return chain(request);
}
