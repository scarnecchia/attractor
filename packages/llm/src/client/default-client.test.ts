import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from './client.js';
import {
  getDefaultClient,
  setDefaultClient,
  resetDefaultClient,
} from './default-client.js';
import type { ProviderAdapter } from '../types/index.js';

function createMockAdapter(name: string): ProviderAdapter {
  return {
    name,
    complete: vi.fn().mockResolvedValue({
      model: 'mock-model',
      content: [{ type: 'text' as const, text: 'mock response' }],
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
    stream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'start' as const, model: 'mock-model' };
        yield {
          type: 'text-delta' as const,
          text: 'mock',
        };
        yield { type: 'stop' as const, stopReason: 'end_turn' };
      })()
    ),
  };
}

describe('Default Client', () => {
  beforeEach(() => {
    resetDefaultClient();
    vi.clearAllMocks();
  });

  describe('AC1.5: Lazy initialization from environment', () => {
    it('should create client from env on first call to getDefaultClient()', () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key');

      const mockAdapterFactory = vi.fn().mockReturnValue(createMockAdapter('openai'));
      const client1 = getDefaultClient({ openai: mockAdapterFactory });

      expect(client1).toBeInstanceOf(Client);
      expect(mockAdapterFactory).toHaveBeenCalledWith('test-key');
    });

    it('should return the same cached instance on second call to getDefaultClient()', () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key');

      const mockAdapterFactory = vi.fn().mockReturnValue(createMockAdapter('openai'));
      const client1 = getDefaultClient({ openai: mockAdapterFactory });
      const client2 = getDefaultClient({ openai: mockAdapterFactory });

      expect(client1).toBe(client2);
      expect(mockAdapterFactory).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC1.6: Setting default client', () => {
    it('should override lazy-initialized client when setDefaultClient() is called', () => {
      const customClient = new Client({ providers: {} });
      setDefaultClient(customClient);

      const retrieved = getDefaultClient();
      expect(retrieved).toBe(customClient);
    });

    it('should allow overriding lazy-initialized client: lazy init, then set, then get returns override', () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key');
      const mockAdapterFactory = vi.fn().mockReturnValue(createMockAdapter('openai'));

      // First call: lazy initialize
      const lazyClient = getDefaultClient({ openai: mockAdapterFactory });
      expect(lazyClient).toBeInstanceOf(Client);

      // Override with custom client
      const customClient = new Client({ providers: {} });
      setDefaultClient(customClient);

      // Verify that setDefaultClient overrides the lazy-initialized one
      const retrieved = getDefaultClient();
      expect(retrieved).toBe(customClient);
      expect(retrieved).not.toBe(lazyClient);
    });
  });

  describe('Reset for testing', () => {
    it('should clear cache when resetDefaultClient() is called', () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key');
      const mockAdapterFactory = vi.fn().mockReturnValue(createMockAdapter('openai'));

      const client1 = getDefaultClient({ openai: mockAdapterFactory });
      resetDefaultClient();
      const client2 = getDefaultClient({ openai: mockAdapterFactory });

      expect(client1).not.toBe(client2);
      expect(mockAdapterFactory).toHaveBeenCalledTimes(2);
    });

    it('should re-initialize from env after resetDefaultClient()', () => {
      const mockAdapterFactory1 = vi.fn().mockReturnValue(createMockAdapter('openai'));
      const mockAdapterFactory2 = vi.fn().mockReturnValue(createMockAdapter('openai'));

      // First initialization with key1
      vi.stubEnv('OPENAI_API_KEY', 'key1');
      const client1 = getDefaultClient({ openai: mockAdapterFactory1 });
      expect(client1).toBeInstanceOf(Client);
      expect(mockAdapterFactory1).toHaveBeenCalledWith('key1');

      // Reset
      resetDefaultClient();

      // Second initialization with key2 and different factory
      vi.stubEnv('OPENAI_API_KEY', 'key2');
      const client2 = getDefaultClient({ openai: mockAdapterFactory2 });
      expect(client2).toBeInstanceOf(Client);
      expect(client1).not.toBe(client2);
      expect(mockAdapterFactory2).toHaveBeenCalledWith('key2');
    });
  });
});
