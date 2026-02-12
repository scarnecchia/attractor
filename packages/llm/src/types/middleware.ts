import type { LLMRequest } from './request.js';
import type { LLMResponse } from './response.js';
import type { StreamEvent } from './stream.js';

export type Middleware = (
  request: LLMRequest,
  next: (request: LLMRequest) => Promise<LLMResponse> | AsyncIterable<StreamEvent>,
) => Promise<LLMResponse> | AsyncIterable<StreamEvent>;
