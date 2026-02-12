import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, fetchStream } from './http.js';
import { AbortError, ProviderError } from '../types/error.js';

describe('http', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('fetchWithTimeout', () => {
    it('should return parsed JSON body on successful response', async () => {
      const mockBody = { test: 'data' };
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockBody),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      const result = await fetchWithTimeout({
        url: 'https://example.com/api',
      });

      expect(result.body).toEqual(mockBody);
      expect(result.response).toBe(mockResponse);
    });


    it('should throw AbortError if external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        fetchWithTimeout({
          url: 'https://example.com/api',
          signal: controller.signal,
        }),
      ).rejects.toThrow(AbortError);

      // fetch should not have been called
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('should throw ProviderError on non-2xx status', async () => {
      const errorBody = 'Internal Server Error';
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue(errorBody),
        headers: new Headers(),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      await expect(
        fetchWithTimeout({
          url: 'https://example.com/api',
        }),
      ).rejects.toThrow(ProviderError);
    });

    it('should merge default Content-Type header', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      await fetchWithTimeout({
        url: 'https://example.com/api',
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const options = calls[0]?.[1] as Record<string, unknown> | undefined;
      const headers = options?.['headers'] as Record<string, string> | undefined;
      expect(headers?.['Content-Type']).toBe('application/json');
    });

    it('should allow custom headers to override defaults', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      await fetchWithTimeout({
        url: 'https://example.com/api',
        headers: { 'Content-Type': 'application/xml' },
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const options = calls[0]?.[1] as Record<string, unknown> | undefined;
      const headers = options?.['headers'] as Record<string, string> | undefined;
      expect(headers?.['Content-Type']).toBe('application/xml');
    });

    it('should serialize body as JSON when provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      const bodyData = { key: 'value' };
      await fetchWithTimeout({
        url: 'https://example.com/api',
        body: bodyData,
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const options = calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(options?.['body']).toBe(JSON.stringify(bodyData));
    });

    it('should convert native AbortError to SDK AbortError', async () => {
      const nativeAbortError = new Error('Aborted');
      nativeAbortError.name = 'AbortError';

      vi.mocked(globalThis.fetch).mockRejectedValue(nativeAbortError);

      await expect(
        fetchWithTimeout({
          url: 'https://example.com/api',
        }),
      ).rejects.toThrow(AbortError);
    });

  });

  describe('fetchStream', () => {
    it('should return raw Response object without parsing JSON', async () => {
      const mockResponse = {
        ok: true,
        body: { stream: true },
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      const result = await fetchStream({
        url: 'https://example.com/api',
      });

      expect(result).toBe(mockResponse);
      // json() should not be called
    });

    it('should throw ProviderError on non-2xx status', async () => {
      const errorBody = 'Not Found';
      const mockResponse = {
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue(errorBody),
        headers: new Headers(),
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      await expect(
        fetchStream({
          url: 'https://example.com/api',
        }),
      ).rejects.toThrow(ProviderError);
    });

    it('should merge default Content-Type header', async () => {
      const mockResponse = {
        ok: true,
      };

      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as globalThis.Response,
      );

      await fetchStream({
        url: 'https://example.com/api',
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const options = calls[0]?.[1] as Record<string, unknown> | undefined;
      const headers = options?.['headers'] as Record<string, string> | undefined;
      expect(headers?.['Content-Type']).toBe('application/json');
    });

    it('should throw AbortError if external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        fetchStream({
          url: 'https://example.com/api',
          signal: controller.signal,
        }),
      ).rejects.toThrow(AbortError);

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

  });
});
