import type { ProviderAdapter, LLMRequest, LLMResponse, StreamEvent } from '../../types/index.js';
import { fetchWithTimeout, fetchStream } from '../../utils/http.js';
import { createSSEStream } from '../../utils/sse.js';
import { translateRequest } from './request.js';
import { translateResponse } from './response.js';
import { translateStream } from './stream.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, options?: { readonly baseUrl?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { url, headers, body, toolCallIdMap } = translateRequest(request, this.apiKey, this.baseUrl, false);

    const result = await fetchWithTimeout({
      url,
      method: 'POST',
      headers,
      body,
      timeout: request.timeout,
      signal: request.signal,
      provider: 'gemini',
    });

    return translateResponse(result.body as Record<string, unknown>, toolCallIdMap);
  }

  async* stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const { url, headers, body, toolCallIdMap } = translateRequest(request, this.apiKey, this.baseUrl, true);

    const response = await fetchStream({
      url,
      method: 'POST',
      headers,
      body,
      timeout: request.timeout,
      signal: request.signal,
      provider: 'gemini',
    });

    const sseStream = createSSEStream(response);
    yield* translateStream(sseStream, toolCallIdMap);
  }
}

export { translateRequest, translateResponse, translateStream };
