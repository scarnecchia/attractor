import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from './client.js';
import { ConfigurationError } from '../types/index.js';
import type { ProviderAdapter, LLMRequest, LLMResponse, StreamEvent } from '../types/index.js';
import { emptyUsage } from '../types/index.js';

function createMockAdapter(name: string): ProviderAdapter {
  return {
    name,
    complete: vi.fn().mockResolvedValue({
      id: `response-${name}`,
      model: 'test-model',
      content: [],
      finishReason: 'stop' as const,
      usage: emptyUsage(),
      rateLimitInfo: null,
      warnings: [],
      steps: [],
      providerMetadata: {},
    } as LLMResponse),
    stream: vi.fn().mockReturnValue((async function* () {
      yield {
        type: 'STREAM_START',
        id: `stream-${name}`,
        model: 'test-model',
      } as StreamEvent;
    })()),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Client', () => {
  describe('constructor', () => {
    it('should store providers from config', () => {
      const adapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: adapter } });
      expect(client).toBeDefined();
    });

    it('should use single registered provider as default when no explicit default', async () => {
      const adapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: adapter } });
      // Test by calling complete without specifying provider
      await expect(client.complete({ model: 'gpt-4' })).resolves.toBeDefined();
    });

    it('should use explicit default provider from config', () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
        defaultProvider: 'anthropic',
      });
      expect(client).toBeDefined();
    });

    it('should accept middleware in config', () => {
      const adapter = createMockAdapter('openai');
      const middleware = vi.fn((req, next) => next(req));
      const client = new Client({
        providers: { openai: adapter },
        middleware: [middleware],
      });
      expect(client).toBeDefined();
    });
  });

  describe('complete()', () => {
    it('should route to specified provider when request includes provider field', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
      });

      await client.complete({ model: 'gpt-4', provider: 'openai' });

      expect(openaiAdapter.complete).toHaveBeenCalled();
      expect(anthropicAdapter.complete).not.toHaveBeenCalled();
    });

    it('should route to different provider when specified', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
      });

      await client.complete({ model: 'claude-3', provider: 'anthropic' });

      expect(anthropicAdapter.complete).toHaveBeenCalled();
      expect(openaiAdapter.complete).not.toHaveBeenCalled();
    });

    it('should use default provider when request does not specify provider', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const client = new Client({
        providers: { openai: openaiAdapter },
        defaultProvider: 'openai',
      });

      await client.complete({ model: 'gpt-4' });

      expect(openaiAdapter.complete).toHaveBeenCalled();
    });

    it('should use implicit default (single provider) when request does not specify provider', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: openaiAdapter } });

      await client.complete({ model: 'gpt-4' });

      expect(openaiAdapter.complete).toHaveBeenCalled();
    });

    it('should throw ConfigurationError when no providers configured', async () => {
      const client = new Client({ providers: {} });

      await expect(client.complete({ model: 'gpt-4' })).rejects.toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when request specifies unknown provider', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: openaiAdapter } });

      await expect(client.complete({ model: 'gpt-4', provider: 'unknown' })).rejects.toThrow(
        ConfigurationError,
      );
    });

    it('should throw ConfigurationError when multiple providers and no default set', async () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
      });

      await expect(client.complete({ model: 'test' })).rejects.toThrow(ConfigurationError);
    });

    it('should pass request to adapter complete method', async () => {
      const adapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: adapter } });
      const request: LLMRequest = { model: 'gpt-4', provider: 'openai' };

      await client.complete(request);

      expect(adapter.complete).toHaveBeenCalledWith(request);
    });

    it('should return response from adapter', async () => {
      const mockResponse: LLMResponse = {
        id: 'response-1',
        model: 'gpt-4',
        content: [],
        finishReason: 'stop',
        usage: emptyUsage(),
        rateLimitInfo: null,
        warnings: [],
        steps: [],
        providerMetadata: {},
      };
      const adapter = createMockAdapter('openai');
      (adapter.complete as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      const client = new Client({ providers: { openai: adapter } });

      const response = await client.complete({ model: 'gpt-4', provider: 'openai' });

      expect(response).toEqual(mockResponse);
    });
  });

  describe('stream()', () => {
    it('should route to specified provider', () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
      });

      const result = client.stream({ model: 'gpt-4', provider: 'openai' });

      expect(result).toBeDefined();
      expect(openaiAdapter.stream).toHaveBeenCalled();
      expect(anthropicAdapter.stream).not.toHaveBeenCalled();
    });

    it('should route different provider when specified', () => {
      const openaiAdapter = createMockAdapter('openai');
      const anthropicAdapter = createMockAdapter('anthropic');
      const client = new Client({
        providers: { openai: openaiAdapter, anthropic: anthropicAdapter },
      });

      const result = client.stream({ model: 'claude-3', provider: 'anthropic' });

      expect(result).toBeDefined();
      expect(anthropicAdapter.stream).toHaveBeenCalled();
      expect(openaiAdapter.stream).not.toHaveBeenCalled();
    });

    it('should use default provider when request does not specify provider', () => {
      const openaiAdapter = createMockAdapter('openai');
      const client = new Client({
        providers: { openai: openaiAdapter },
        defaultProvider: 'openai',
      });

      const result = client.stream({ model: 'gpt-4' });

      expect(result).toBeDefined();
      expect(openaiAdapter.stream).toHaveBeenCalled();
    });

    it('should throw ConfigurationError when no providers configured', () => {
      const client = new Client({ providers: {} });

      expect(() => client.stream({ model: 'gpt-4' })).toThrow(ConfigurationError);
    });

    it('should throw ConfigurationError when request specifies unknown provider', () => {
      const openaiAdapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: openaiAdapter } });

      expect(() => client.stream({ model: 'gpt-4', provider: 'unknown' })).toThrow(
        ConfigurationError,
      );
    });

    it('should return AsyncIterable from adapter', () => {
      const adapter = createMockAdapter('openai');
      const client = new Client({ providers: { openai: adapter } });

      const result = client.stream({ model: 'gpt-4', provider: 'openai' });

      expect(result).toBeDefined();
      expect(typeof result[Symbol.asyncIterator]).toBe('function');
    });
  });

  describe('fromEnv()', () => {
    it('should create client with adapters for detected providers', () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');

      const factories = {
        openai: vi.fn(() => createMockAdapter('openai')),
        anthropic: vi.fn(() => createMockAdapter('anthropic')),
      };

      const client = Client.fromEnv(factories);

      expect(factories.openai).toHaveBeenCalledWith('test-openai-key');
      expect(factories.anthropic).toHaveBeenCalledWith('test-anthropic-key');
      expect(client).toBeDefined();
    });

    it('should register only single provider when only one API key set', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('GEMINI_API_KEY', '');

      const factories = {
        openai: vi.fn(() => createMockAdapter('openai')),
        anthropic: vi.fn(() => createMockAdapter('anthropic')),
        gemini: vi.fn(() => createMockAdapter('gemini')),
      };

      const client = Client.fromEnv(factories);

      expect(factories.anthropic).toHaveBeenCalledWith('test-anthropic-key');
      expect(factories.openai).not.toHaveBeenCalled();
      expect(factories.gemini).not.toHaveBeenCalled();
      expect(client).toBeDefined();
    });

    it('should use GEMINI_API_KEY when set', () => {
      vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
      vi.stubEnv('GOOGLE_API_KEY', '');

      const factories = {
        gemini: vi.fn(() => createMockAdapter('gemini')),
      };

      Client.fromEnv(factories);

      expect(factories.gemini).toHaveBeenCalledWith('test-gemini-key');
    });

    it('should use GOOGLE_API_KEY as alternative for Gemini', () => {
      vi.stubEnv('GOOGLE_API_KEY', 'test-google-key');
      vi.stubEnv('GEMINI_API_KEY', '');

      const factories = {
        gemini: vi.fn(() => createMockAdapter('gemini')),
      };

      Client.fromEnv(factories);

      expect(factories.gemini).toHaveBeenCalledWith('test-google-key');
    });

    it('should prefer GEMINI_API_KEY over GOOGLE_API_KEY', () => {
      vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
      vi.stubEnv('GOOGLE_API_KEY', 'test-google-key');

      const factories = {
        gemini: vi.fn(() => createMockAdapter('gemini')),
      };

      Client.fromEnv(factories);

      expect(factories.gemini).toHaveBeenCalledWith('test-gemini-key');
    });
  });

  describe('close()', () => {
    it('should call close on all adapters that have it', async () => {
      const adapter1 = createMockAdapter('openai');
      const adapter2 = createMockAdapter('anthropic');
      const client = new Client({ providers: { openai: adapter1, anthropic: adapter2 } });

      await client.close();

      expect(adapter1.close).toHaveBeenCalled();
      expect(adapter2.close).toHaveBeenCalled();
    });

    it('should handle adapters that dont have close method', async () => {
      const adapter = createMockAdapter('openai');
      delete adapter.close;
      const client = new Client({ providers: { openai: adapter } });

      await expect(client.close()).resolves.not.toThrow();
    });

    it('should not throw even if one adapter close fails', async () => {
      const adapter1 = createMockAdapter('openai');
      const adapter2 = createMockAdapter('anthropic');

      (adapter1.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('close failed'));

      const client = new Client({ providers: { openai: adapter1, anthropic: adapter2 } });

      await expect(client.close()).resolves.not.toThrow();
      expect(adapter2.close).toHaveBeenCalled();
    });
  });

  describe('middleware integration', () => {
    it('should execute middleware before handler for complete', async () => {
      const calls: Array<string> = [];
      const adapter = createMockAdapter('openai');

      (adapter.complete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        calls.push('handler');
        return {
          id: 'response-1',
          model: 'gpt-4',
          content: [],
          finishReason: 'stop' as const,
          usage: emptyUsage(),
          rateLimitInfo: null,
          warnings: [],
          steps: [],
          providerMetadata: {},
        };
      });

      const middleware = vi.fn(async (req, next) => {
        calls.push('middleware-before');
        const result = await next(req);
        calls.push('middleware-after');
        return result;
      });

      const client = new Client({
        providers: { openai: adapter },
        middleware: [middleware],
      });

      await client.complete({ model: 'gpt-4', provider: 'openai' });

      expect(calls).toEqual(['middleware-before', 'handler', 'middleware-after']);
    });

    it('should pass request through middleware chain', async () => {
      const adapter = createMockAdapter('openai');
      const middleware = vi.fn((req, next) => next(req));

      const client = new Client({
        providers: { openai: adapter },
        middleware: [middleware],
      });

      const request: LLMRequest = { model: 'gpt-4', provider: 'openai' };
      await client.complete(request);

      expect(middleware).toHaveBeenCalledWith(request, expect.any(Function));
    });
  });
});
