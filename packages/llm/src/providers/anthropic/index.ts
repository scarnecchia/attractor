import type { ProviderAdapter, LLMRequest, LLMResponse, StreamEvent } from '../../types/index.js';
import { fetchWithTimeout, fetchStream } from '../../utils/http.js';
import { createSSEStream } from '../../utils/sse.js';
import { translateRequest } from './request.js';
import { translateResponse } from './response.js';
import { translateStream } from './stream.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, options?: { readonly baseUrl?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl || 'https://api.anthropic.com';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { url, headers, body } = translateRequest(request, this.apiKey, this.baseUrl);

    const result = await fetchWithTimeout({
      url,
      method: 'POST',
      headers,
      body,
      timeout: request.timeout,
      signal: request.signal,
      provider: 'anthropic',
    });

    return translateResponse(result.body as Record<string, unknown>);
  }

  async* stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const { url, headers, body } = translateRequest(request, this.apiKey, this.baseUrl);
    const bodyWithStream = { ...body, stream: true };

    const response = await fetchStream({
      url,
      method: 'POST',
      headers,
      body: bodyWithStream,
      timeout: request.timeout,
      signal: request.signal,
      provider: 'anthropic',
    });

    const sseStream = createSSEStream(response);
    yield* translateStream(sseStream);
  }
}

export { translateRequest, translateResponse, translateStream };
