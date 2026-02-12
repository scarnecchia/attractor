import { ProviderError } from '../types/error.js';
import type { RetryPolicy } from '../types/config.js';

export type RetryOptions = {
  readonly policy: RetryPolicy;
  readonly onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
};

export function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
): number {
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  return Math.min(exponentialDelay, maxDelayMs);
}

/**
 * Retries a single operation with exponential backoff.
 *
 * AC7.5: Callers must wrap individual operations, not multi-step sequences.
 * Each call to retry() should wrap a single atomic operation. Do not pass a function
 * that performs multiple sequential steps, as failures in later steps may not be retryable.
 *
 * AC7.6: Streaming operations should not use this function after partial data delivery.
 * Once streaming has begun and partial data has been delivered to the caller,
 * retrying becomes unsafe. Only wrap the initial fetch/setup, not the streaming loop.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { policy, onRetry } = options;
  const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = policy;

  let lastError: ProviderError | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      // Only handle ProviderError; other errors propagate
      if (!(error instanceof ProviderError)) {
        throw error;
      }

      lastError = error;

      // If not retryable, throw immediately
      if (!error.retryable) {
        throw error;
      }

      // If we've exhausted retries, throw the last error
      if (attempt >= maxRetries) {
        throw error;
      }

      // Calculate delay
      let delayMs = calculateBackoff(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);

      // Apply Retry-After if present
      if (error.retryAfter !== null) {
        if (error.retryAfter > maxDelayMs) {
          // Retry-After exceeds maxDelay, skip retry and throw immediately
          throw error;
        }
        // Use Retry-After as delay instead of calculated backoff
        delayMs = error.retryAfter;
      }

      // Add jitter: 0-25% of delay
      const jitter = Math.random() * 0.25 * delayMs;
      const finalDelayMs = delayMs + jitter;

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(error, attempt + 1, finalDelayMs);
      }

      // Wait before retrying
      await new Promise((resolve) => {
        setTimeout(resolve, finalDelayMs);
      });

      attempt += 1;
    }
  }

  // This should not be reached due to the exhaustion check above, but for type safety
  if (lastError) {
    throw lastError;
  }

  throw new Error('Retry logic error: no error to throw');
}
