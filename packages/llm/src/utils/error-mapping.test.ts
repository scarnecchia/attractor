import { describe, it, expect } from 'vitest';
import {
  mapHttpError,
  parseRetryAfter,
  type MapHttpErrorOptions,
} from './error-mapping.js';
import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  ContextLengthError,
  RateLimitError,
  ContentFilterError,
  ServerError,
} from '../types/error.js';

describe('error-mapping', () => {
  describe('parseRetryAfter', () => {
    it('should parse numeric Retry-After header as seconds and return milliseconds', () => {
      const headers = new Headers({ 'Retry-After': '30' });
      const result = parseRetryAfter(headers);
      expect(result).toBe(30000);
    });

    it('should parse HTTP date Retry-After header and compute delta', () => {
      const futureDate = new Date(Date.now() + 60000); // 60 seconds from now
      const headers = new Headers({ 'Retry-After': futureDate.toUTCString() });
      const result = parseRetryAfter(headers);
      expect(result).toBeGreaterThan(50000); // Allow some timing variance
      expect(result).toBeLessThanOrEqual(60000);
    });

    it('should return null if Retry-After header is absent', () => {
      const headers = new Headers();
      const result = parseRetryAfter(headers);
      expect(result).toBeNull();
    });

    it('should return 0 if HTTP date is in the past', () => {
      const pastDate = new Date(Date.now() - 60000); // 60 seconds ago
      const headers = new Headers({ 'Retry-After': pastDate.toUTCString() });
      const result = parseRetryAfter(headers);
      expect(result).toBe(0);
    });

    it('should handle invalid date strings gracefully', () => {
      const headers = new Headers({ 'Retry-After': 'not-a-valid-date' });
      const result = parseRetryAfter(headers);
      expect(result).toBeNull();
    });
  });

  describe('mapHttpError', () => {
    const baseOptions = (
      overrides?: Partial<MapHttpErrorOptions>,
    ): MapHttpErrorOptions => ({
      statusCode: 500,
      body: 'Error occurred',
      provider: 'test-provider',
      headers: new Headers(),
      raw: null,
      ...overrides,
    });

    describe('AC6.1: Status 401 -> AuthenticationError', () => {
      it('should map HTTP 401 to AuthenticationError with retryable=false', () => {
        const error = mapHttpError(baseOptions({ statusCode: 401 }));
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error.statusCode).toBe(401);
        expect(error.retryable).toBe(false);
        expect(error.provider).toBe('test-provider');
      });
    });

    describe('AC6.2: Status 429 -> RateLimitError', () => {
      it('should map HTTP 429 to RateLimitError with retryable=true', () => {
        const error = mapHttpError(baseOptions({ statusCode: 429 }));
        expect(error).toBeInstanceOf(RateLimitError);
        expect(error.statusCode).toBe(429);
        expect(error.retryable).toBe(true);
      });
    });

    describe('AC6.3: Status 5xx -> ServerError', () => {
      it('should map HTTP 500 to ServerError with retryable=true', () => {
        const error = mapHttpError(baseOptions({ statusCode: 500 }));
        expect(error).toBeInstanceOf(ServerError);
        expect(error.statusCode).toBe(500);
        expect(error.retryable).toBe(true);
      });

      it('should map HTTP 502 to ServerError with retryable=true', () => {
        const error = mapHttpError(baseOptions({ statusCode: 502 }));
        expect(error).toBeInstanceOf(ServerError);
        expect(error.statusCode).toBe(502);
        expect(error.retryable).toBe(true);
      });

      it('should map HTTP 503 to ServerError with retryable=true', () => {
        const error = mapHttpError(baseOptions({ statusCode: 503 }));
        expect(error).toBeInstanceOf(ServerError);
        expect(error.statusCode).toBe(503);
        expect(error.retryable).toBe(true);
      });
    });

    describe('AC6.4: Status 404 -> NotFoundError', () => {
      it('should map HTTP 404 to NotFoundError with retryable=false', () => {
        const error = mapHttpError(baseOptions({ statusCode: 404 }));
        expect(error).toBeInstanceOf(NotFoundError);
        expect(error.statusCode).toBe(404);
        expect(error.retryable).toBe(false);
      });
    });

    describe('Status code mapping: 400, 413, 422, 403', () => {
      it('should map HTTP 400 without content filter/context keywords to InvalidRequestError', () => {
        const error = mapHttpError(baseOptions({ statusCode: 400 }));
        expect(error).toBeInstanceOf(InvalidRequestError);
        expect(error.statusCode).toBe(400);
        expect(error.retryable).toBe(false);
      });

      it('should map HTTP 413 to ContextLengthError with retryable=false', () => {
        const error = mapHttpError(baseOptions({ statusCode: 413 }));
        expect(error).toBeInstanceOf(ContextLengthError);
        expect(error.statusCode).toBe(413);
        expect(error.retryable).toBe(false);
      });

      it('should map HTTP 422 to InvalidRequestError with retryable=false', () => {
        const error = mapHttpError(baseOptions({ statusCode: 422 }));
        expect(error).toBeInstanceOf(InvalidRequestError);
        expect(error.statusCode).toBe(422);
        expect(error.retryable).toBe(false);
      });

      it('should map HTTP 403 to AccessDeniedError with retryable=false', () => {
        const error = mapHttpError(baseOptions({ statusCode: 403 }));
        expect(error).toBeInstanceOf(AccessDeniedError);
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
      });
    });

    describe('AC6.6: Message-based classification for ambiguous status codes', () => {
      it('should classify HTTP 400 with "content_filter" as ContentFilterError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Request blocked by content_filter',
          }),
        );
        expect(error).toBeInstanceOf(ContentFilterError);
        expect(error.statusCode).toBe(400);
        expect(error.retryable).toBe(false);
      });

      it('should classify HTTP 400 with "content_policy" as ContentFilterError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Violates content_policy',
          }),
        );
        expect(error).toBeInstanceOf(ContentFilterError);
      });

      it('should classify HTTP 400 with "safety" as ContentFilterError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Safety check failed',
          }),
        );
        expect(error).toBeInstanceOf(ContentFilterError);
      });

      it('should classify HTTP 400 with "context_length" as ContextLengthError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Exceeded context_length limit',
          }),
        );
        expect(error).toBeInstanceOf(ContextLengthError);
      });

      it('should classify HTTP 400 with "too many tokens" as ContextLengthError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Request has too many tokens',
          }),
        );
        expect(error).toBeInstanceOf(ContextLengthError);
      });

      it('should classify HTTP 400 with "maximum context" as ContextLengthError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Exceeds maximum context size',
          }),
        );
        expect(error).toBeInstanceOf(ContextLengthError);
      });

      it('should classify generic HTTP 400 without keywords as InvalidRequestError', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Invalid parameter value',
          }),
        );
        expect(error).toBeInstanceOf(InvalidRequestError);
      });

      it('should be case-insensitive when matching keywords', () => {
        const error = mapHttpError(
          baseOptions({
            statusCode: 400,
            body: 'Request blocked by CONTENT_FILTER',
          }),
        );
        expect(error).toBeInstanceOf(ContentFilterError);
      });
    });

    describe('AC6.5: Retry-After header parsing and setting', () => {
      it('should set retryAfter on RateLimitError when Retry-After header is present', () => {
        const headers = new Headers({ 'Retry-After': '60' });
        const error = mapHttpError(
          baseOptions({
            statusCode: 429,
            headers,
          }),
        );
        expect(error).toBeInstanceOf(RateLimitError);
        expect(error.retryAfter).toBe(60000);
      });

      it('should set retryAfter on ServerError when Retry-After header is present', () => {
        const headers = new Headers({ 'Retry-After': '45' });
        const error = mapHttpError(
          baseOptions({
            statusCode: 500,
            headers,
          }),
        );
        expect(error).toBeInstanceOf(ServerError);
        expect(error.retryAfter).toBe(45000);
      });

      it('should have null retryAfter when Retry-After header is absent', () => {
        const error = mapHttpError(baseOptions({ statusCode: 429 }));
        expect(error.retryAfter).toBeNull();
      });
    });
  });
});
