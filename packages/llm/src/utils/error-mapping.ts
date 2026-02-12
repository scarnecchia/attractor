import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  ContextLengthError,
  RateLimitError,
  ContentFilterError,
  ServerError,
  ProviderError,
} from '../types/error.js';

export type MapHttpErrorOptions = {
  readonly statusCode: number;
  readonly body: string;
  readonly provider: string;
  readonly headers: Headers;
  readonly raw?: unknown;
};

/**
 * Parses the Retry-After header from response headers.
 * Returns milliseconds, or null if header is not present.
 *
 * - Numeric value (seconds): parsed as int and converted to ms
 * - HTTP date string: computed as delta from now in ms
 */
export function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get('Retry-After');
  if (!retryAfter) {
    return null;
  }

  // Try parsing as numeric (seconds) - only if it's a valid integer string
  if (/^\d+$/.test(retryAfter)) {
    const numSeconds = Number(retryAfter);
    return numSeconds * 1000;
  }

  // Try parsing as HTTP date
  try {
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
      const deltaMs = retryDate.getTime() - Date.now();
      return Math.max(0, deltaMs);
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Maps HTTP status codes and response bodies to appropriate ProviderError subclasses.
 * Uses status code-based classification with message-based fallback for ambiguous codes.
 */
export function mapHttpError(options: MapHttpErrorOptions): ProviderError {
  const { statusCode, body, provider, headers, raw } = options;
  const retryAfter = parseRetryAfter(headers);

  // Direct status code mapping
  switch (statusCode) {
    case 400:
      return classifyHttp400(body, provider, raw, statusCode);

    case 401:
      return new AuthenticationError(
        `Authentication failed: ${body}`,
        statusCode,
        provider,
        null,
        raw,
      );

    case 403:
      return new AccessDeniedError(
        `Access denied: ${body}`,
        statusCode,
        provider,
        null,
        raw,
      );

    case 404:
      return new NotFoundError(
        `Resource not found: ${body}`,
        statusCode,
        provider,
        null,
        raw,
      );

    case 413:
      return new ContextLengthError(
        `Context length exceeded: ${body}`,
        statusCode,
        provider,
        null,
        raw,
      );

    case 422:
      return new InvalidRequestError(
        `Unprocessable entity: ${body}`,
        statusCode,
        provider,
        null,
        raw,
      );

    case 429:
      return new RateLimitError(
        `Rate limit exceeded: ${body}`,
        statusCode,
        provider,
        null,
        raw,
        retryAfter,
      );

    default:
      // 5xx status codes
      if (statusCode >= 500) {
        return new ServerError(
          `Server error: ${body}`,
          statusCode,
          provider,
          null,
          raw,
          retryAfter,
        );
      }

      // Fallback for other status codes
      return new ProviderError(
        `HTTP ${statusCode}: ${body}`,
        statusCode,
        false,
        provider,
        null,
        raw,
      );
  }
}

/**
 * Classifies HTTP 400 responses using message-based detection.
 * Distinguishes between content filter errors, context length errors, and generic invalid request errors.
 */
function classifyHttp400(
  body: string,
  provider: string,
  raw: unknown,
  statusCode: number,
): ProviderError {
  const lowerBody = body.toLowerCase();

  // Check for content filter errors
  if (
    lowerBody.includes('content_filter') ||
    lowerBody.includes('content_policy') ||
    lowerBody.includes('safety')
  ) {
    return new ContentFilterError(
      `Content filtered: ${body}`,
      statusCode,
      provider,
      null,
      raw,
    );
  }

  // Check for context length errors
  if (
    lowerBody.includes('context_length') ||
    lowerBody.includes('too many tokens') ||
    lowerBody.includes('maximum context')
  ) {
    return new ContextLengthError(
      `Context length exceeded: ${body}`,
      statusCode,
      provider,
      null,
      raw,
    );
  }

  // Default to invalid request
  return new InvalidRequestError(
    `Invalid request: ${body}`,
    statusCode,
    provider,
    null,
    raw,
  );
}
