import type { ProviderAdapter, LLMRequest, LLMResponse, StreamEvent } from '../../types/index.js';
import { fetchWithTimeout, fetchStream } from '../../utils/http.js';
import { createSSEStream } from '../../utils/sse.js';
import { translateRequest } from './request.js';
import { translateResponse } from './response.js';
import { translateStream } from './stream.js';

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, options?: { readonly baseUrl?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl || 'https://api.openai.com';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { url, headers, body } = translateRequest(request, this.apiKey, false);

    const result = await fetchWithTimeout({
      url,
      method: 'POST',
      headers,
      body,
      timeout: request.timeout,
      signal: request.signal,
    });

    return translateResponse(result.body as Record<string, unknown>);
  }

  async* stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const { url, headers, body } = translateRequest(request, this.apiKey, true);

    const response = await fetchStream({
      url,
      method: 'POST',
      headers,
      body,
      timeout: request.timeout,
      signal: request.signal,
    });

    const sseStream = createSSEStream(response);
    yield* translateStream(sseStream);
  }
}

export { translateRequest, translateResponse, translateStream };
