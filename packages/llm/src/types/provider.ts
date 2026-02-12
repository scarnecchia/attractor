import type { LLMRequest } from './request.js';
import type { LLMResponse } from './response.js';
import type { StreamEvent } from './stream.js';

export interface ProviderAdapter {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<StreamEvent>;
  close?(): Promise<void>;
  initialize?(): Promise<void>;
  supportsToolChoice?(mode: string): boolean;
}
