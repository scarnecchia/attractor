import type { RetryPolicy } from '../types/config.js';

/**
 * Default retry policy for API calls.
 * Applied to all client.complete() and client.stream() calls.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};
