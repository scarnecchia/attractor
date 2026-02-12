export class SDKError extends Error {
  override name: string;
  override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class ConfigurationError extends SDKError {}

export class ValidationError extends SDKError {}

export class AbortError extends SDKError {}

export class RequestTimeoutError extends SDKError {}

export class NoObjectGeneratedError extends SDKError {
  readonly raw: unknown;

  constructor(message: string, raw: unknown) {
    super(message);
    this.raw = raw;
  }
}

export class NetworkError extends SDKError {}

export class StreamError extends SDKError {}

export class InvalidToolCallError extends SDKError {}

export class ProviderError extends SDKError {
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly retryAfter: number | null;
  readonly provider: string;
  readonly errorCode: string | null;
  readonly raw: unknown;

  constructor(
    message: string,
    statusCode: number,
    retryable: boolean,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.provider = provider;
    this.errorCode = errorCode;
    this.raw = raw;
  }
}

export class AuthenticationError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class AccessDeniedError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class NotFoundError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class ContextLengthError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, statusCode, true, provider, errorCode, raw, retryAfter);
  }
}

export class QuotaExceededError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class ContentFilterError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
  ) {
    super(message, statusCode, false, provider, errorCode, raw);
  }
}

export class ServerError extends ProviderError {
  constructor(
    message: string,
    statusCode: number,
    provider: string,
    errorCode: string | null = null,
    raw: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, statusCode, true, provider, errorCode, raw, retryAfter);
  }
}
