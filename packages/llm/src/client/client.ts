import type { LLMRequest, LLMResponse, StreamEvent, Middleware, ProviderAdapter } from '../types/index.js';
import { ConfigurationError } from '../types/index.js';
import { executeMiddlewareChain } from './middleware.js';
import { detectProviders, type ClientConfig } from './config.js';

export class Client {
  private readonly providers: Record<string, ProviderAdapter>;
  private readonly defaultProvider: string | null;
  private readonly middlewares: ReadonlyArray<Middleware>;

  constructor(config: ClientConfig) {
    this.providers = config.providers;
    this.middlewares = config.middleware ?? [];

    // If no default provider specified and exactly one provider registered, use it as default
    if (config.defaultProvider === undefined) {
      const providerNames = Object.keys(config.providers);
      this.defaultProvider = providerNames.length === 1 ? providerNames[0] ?? null : null;
    } else {
      this.defaultProvider = config.defaultProvider;
    }
  }

  static fromEnv(adapterFactories?: Record<string, (apiKey: string) => ProviderAdapter>): Client {
    const detectedConfig = detectProviders();
    const providers: Record<string, ProviderAdapter> = {};

    if (adapterFactories) {
      for (const [providerName, config] of Object.entries(detectedConfig)) {
        const factory = adapterFactories[providerName];
        if (factory && typeof config === 'object' && config !== null && 'apiKey' in config) {
          const apiKey = config['apiKey'];
          if (typeof apiKey === 'string') {
            providers[providerName] = factory(apiKey);
          }
        }
      }
    }

    return new Client({ providers });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.resolveProvider(request);
    const adapter = this.providers[provider];

    if (!adapter) {
      throw new ConfigurationError(`provider '${provider}' not configured`);
    }

    const handler = (req: LLMRequest) => adapter.complete(req);
    const result = executeMiddlewareChain(this.middlewares, request, handler);

    // Ensure we're returning a Promise<LLMResponse>
    if (result instanceof Promise) {
      return result;
    }

    // If it's an AsyncIterable, something went wrong with middleware/handler
    throw new ConfigurationError('complete() returned AsyncIterable instead of Promise');
  }

  stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const provider = this.resolveProvider(request);
    const adapter = this.providers[provider];

    if (!adapter) {
      throw new ConfigurationError(`provider '${provider}' not configured`);
    }

    const handler = (req: LLMRequest) => adapter.stream(req);
    const result = executeMiddlewareChain(this.middlewares, request, handler);

    // Ensure we're returning an AsyncIterable<StreamEvent>
    if (result instanceof Promise) {
      throw new ConfigurationError('stream() returned Promise instead of AsyncIterable');
    }

    return result;
  }

  async close(): Promise<void> {
    const closePromises = Object.values(this.providers)
      .filter((adapter) => adapter.close !== undefined)
      .map((adapter) => adapter.close?.());

    await Promise.allSettled(closePromises);
  }

  private resolveProvider(request: LLMRequest): string {
    if (request.provider) {
      return request.provider;
    }

    if (this.defaultProvider) {
      return this.defaultProvider;
    }

    throw new ConfigurationError('no provider configured and no default set');
  }
}
