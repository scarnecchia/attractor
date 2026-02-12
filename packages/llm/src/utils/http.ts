import { AbortError } from '../types/error.js';
import { mapHttpError } from './error-mapping.js';
import type { TimeoutConfig } from '../types/config.js';

export type FetchOptions = {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeout?: TimeoutConfig;
  readonly signal?: AbortSignal;
};

export type FetchResult = {
  readonly response: globalThis.Response;
  readonly body: unknown;
};

type ExecuteFetchOptions = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly signal: AbortSignal;
};

/**
 * Executes a fetch request with the given options.
 * Handles abort and HTTP error responses.
 */
async function executeFetch(
  options: ExecuteFetchOptions,
): Promise<globalThis.Response> {
  const { url, method, headers, body, signal } = options;

  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal,
    });
  } catch (err) {
    if (err instanceof globalThis.Error && err.name === 'AbortError') {
      throw new AbortError('Fetch was aborted');
    }
    throw err;
  }
}

/**
 * Fetches with timeout support, header merging, and JSON body serialization.
 * Returns both the raw response and parsed JSON body.
 */
export async function fetchWithTimeout(
  options: FetchOptions,
): Promise<FetchResult> {
  const {
    url,
    method = 'GET',
    headers: customHeaders = {},
    body: bodyData,
    timeout,
    signal: externalSignal,
  } = options;

  if (externalSignal?.aborted) {
    throw new AbortError('Signal was already aborted');
  }

  const timeoutController = new AbortController();
  const linkedSignal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout?.requestMs) {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeout.requestMs);
  }

  try {
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    const body = bodyData !== undefined ? JSON.stringify(bodyData) : undefined;

    const response = await executeFetch({
      url,
      method,
      headers: mergedHeaders,
      body,
      signal: linkedSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw mapHttpError({
        statusCode: response.status,
        body: text,
        provider: 'unknown',
        headers: response.headers,
        raw: text,
      });
    }

    const parsedBody = await response.json();

    return {
      response,
      body: parsedBody,
    };
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Fetches and returns the raw Response object for streaming.
 * Does not parse JSON body.
 */
export async function fetchStream(
  options: FetchOptions,
): Promise<globalThis.Response> {
  const {
    url,
    method = 'GET',
    headers: customHeaders = {},
    body: bodyData,
    timeout,
    signal: externalSignal,
  } = options;

  if (externalSignal?.aborted) {
    throw new AbortError('Signal was already aborted');
  }

  const timeoutController = new AbortController();
  const linkedSignal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout?.requestMs) {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeout.requestMs);
  }

  try {
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    const body = bodyData !== undefined ? JSON.stringify(bodyData) : undefined;

    const response = await executeFetch({
      url,
      method,
      headers: mergedHeaders,
      body,
      signal: linkedSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw mapHttpError({
        statusCode: response.status,
        body: text,
        provider: 'unknown',
        headers: response.headers,
        raw: text,
      });
    }

    return response;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
