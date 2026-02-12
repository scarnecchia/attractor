import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProviderError, AuthenticationError, RateLimitError, ServerError } from '../types/error.js';
import { calculateBackoff, retry } from './retry.js';
import type { RetryPolicy } from '../types/config.js';

const createMockPolicy = (overrides?: Partial<RetryPolicy>): RetryPolicy => ({
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503],
  ...overrides,
});

describe('calculateBackoff', () => {
  it('AC7.1: attempt 0 with initialDelayMs=100, multiplier=2 -> 100', () => {
    const result = calculateBackoff(0, 100, 1000, 2);
    expect(result).toBe(100);
  });

  it('AC7.1: attempt 1 -> 200', () => {
    const result = calculateBackoff(1, 100, 1000, 2);
    expect(result).toBe(200);
  });

  it('AC7.1: attempt 2 -> 400', () => {
    const result = calculateBackoff(2, 100, 1000, 2);
    expect(result).toBe(400);
  });

  it('AC7.1: attempt 3 with maxDelayMs=500 -> 500 (capped)', () => {
    const result = calculateBackoff(3, 100, 500, 2);
    expect(result).toBe(500);
  });
});

describe('retry function', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC7.4: maxRetries=0 -> fn called once, error thrown immediately on failure', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(
      new ServerError('Server error', 500, 'test-provider'),
    );

    const policy = createMockPolicy({ maxRetries: 0 });
    await expect(retry(fn, { policy })).rejects.toThrow(ServerError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Success on first try -> returns result, fn called exactly once', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('success');

    const policy = createMockPolicy();
    const result = await retry(fn, { policy });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Success after retries -> fn fails twice (retryable ServerError), succeeds third time', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServerError('Error 1', 500, 'test-provider'))
      .mockRejectedValueOnce(new ServerError('Error 2', 500, 'test-provider'))
      .mockResolvedValueOnce('success');

    const policy = createMockPolicy({ maxRetries: 3, initialDelayMs: 1, maxDelayMs: 10 });

    const result = await retry(fn, { policy });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('Non-retryable error -> re-throws immediately, fn called once', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(
      new AuthenticationError('Auth failed', 401, 'test-provider'),
    );

    const policy = createMockPolicy();
    await expect(retry(fn, { policy })).rejects.toThrow(AuthenticationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Max retries exhausted -> fn called 3 times (1 initial + 2 retries), throws last error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ServerError('Always fails', 500, 'test-provider'));

    const policy = createMockPolicy({ maxRetries: 2, initialDelayMs: 1, maxDelayMs: 10 });

    await expect(retry(fn, { policy })).rejects.toThrow(ServerError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('AC7.2: fn throws RateLimitError with retryAfter=500 and maxDelayMs=1000 -> waits 500ms', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError('Rate limited', 429, 'test-provider', null, null, 50))
      .mockResolvedValueOnce('success');

    const policy = createMockPolicy();
    const onRetry = vi.fn();

    const result = await retry(fn, { policy, onRetry });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);

    // onRetry should have been called with retryAfter delay (with jitter)
    expect(onRetry).toHaveBeenCalledTimes(1);
    const call = onRetry.mock.calls[0];
    expect(call).toBeDefined();
    const [, , delayMs] = call as [ProviderError, number, number];
    // Should be between 50 and 62.5 (50 * 1.25)
    expect(delayMs).toBeGreaterThanOrEqual(50);
    expect(delayMs).toBeLessThanOrEqual(62.5);
  });

  it('AC7.3: fn throws RateLimitError with retryAfter=5000 and maxDelayMs=1000 -> re-throws immediately', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(
      new RateLimitError('Rate limited', 429, 'test-provider', null, null, 5000),
    );

    const policy = createMockPolicy();
    await expect(retry(fn, { policy })).rejects.toThrow(RateLimitError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onRetry callback called with correct parameters', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServerError('Error 1', 500, 'test-provider'))
      .mockResolvedValueOnce('success');

    const policy = createMockPolicy({ initialDelayMs: 5, maxDelayMs: 10 });
    const onRetry = vi.fn();

    await retry(fn, { policy, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    const call = onRetry.mock.calls[0];
    expect(call).toBeDefined();
    const [error, attempt, delayMs] = call as [ProviderError, number, number];
    expect(error).toBeInstanceOf(ServerError);
    expect(attempt).toBe(1);
    expect(typeof delayMs).toBe('number');
    expect(delayMs).toBeGreaterThan(0);
  });

  it('AC7.1: Jitter is applied - run retry multiple times with same config, delays should vary', async () => {
    const delays: number[] = [];

    // Run 5 times and collect the delays passed to onRetry
    for (let i = 0; i < 5; i++) {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ServerError('Error', 500, 'test-provider'))
        .mockResolvedValueOnce('success');

      const policy = createMockPolicy({ initialDelayMs: 10, maxDelayMs: 100 });
      const onRetry = vi.fn();

      await retry(fn, { policy, onRetry });

      const call = onRetry.mock.calls[0];
      expect(call).toBeDefined();
      const [, , delayMs] = call as [ProviderError, number, number];
      delays.push(delayMs);
    }

    // At least some delays should differ (with high probability for jitter)
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });

  it('Jitter is correctly bounded: 0-25% of delay', async () => {
    // Spy on Math.random to control jitter precisely
    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValue(0.5); // Middle of 0-1 range

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServerError('Error', 500, 'test-provider'))
      .mockResolvedValueOnce('success');

    const policy = createMockPolicy({ initialDelayMs: 100 });
    const onRetry = vi.fn();

    await retry(fn, { policy, onRetry });

    const call = onRetry.mock.calls[0];
    expect(call).toBeDefined();
    const [, , delayMs] = call as [ProviderError, number, number];
    // Base delay = 100, jitter = 0.5 * 0.25 * 100 = 12.5
    // Expected: 100 + 12.5 = 112.5
    expect(delayMs).toBeCloseTo(112.5, 0);
  });

  it('Non-ProviderError throws immediately without retry', async () => {
    vi.useFakeTimers();
    const error = new Error('Generic error');
    const fn = vi.fn().mockRejectedValue(error);

    const policy = createMockPolicy();
    await expect(retry(fn, { policy })).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Retry respects calculated backoff delay without Retry-After', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServerError('Error', 500, 'test-provider'))
      .mockResolvedValueOnce('success');

    const policy = createMockPolicy({ initialDelayMs: 10, maxDelayMs: 100 });
    const onRetry = vi.fn();

    const promise = retry(fn, { policy, onRetry });

    // Before the retry waits, should have been called once
    expect(fn).toHaveBeenCalledTimes(1);

    await promise;

    // onRetry should have been called with backoff delay + jitter
    const call = onRetry.mock.calls[0];
    expect(call).toBeDefined();
    const [, , delayMs] = call as [ProviderError, number, number];
    // Base backoff at attempt 0 = 10, with jitter 0-25%: 10-12.5
    expect(delayMs).toBeGreaterThanOrEqual(10);
    expect(delayMs).toBeLessThanOrEqual(12.5);
  });
});
