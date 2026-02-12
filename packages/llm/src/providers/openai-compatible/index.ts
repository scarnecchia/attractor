import type { ProviderAdapter, LLMRequest, LLMResponse, StreamEvent } from '../../types/index.js';
import { fetchWithTimeout, fetchStream } from '../../utils/http.js';
import { createSSEStream } from '../../utils/sse.js';
import { translateRequest } from './request.js';
import { translateResponse } from './response.js';
import { translateStream } from './stream.js';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string, options?: { readonly name?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.name = options?.name || 'openai-compatible';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { url, headers, body } = translateRequest(request, this.apiKey, this.baseUrl, false);

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
    const { url, headers, body } = translateRequest(request, this.apiKey, this.baseUrl, true);

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
