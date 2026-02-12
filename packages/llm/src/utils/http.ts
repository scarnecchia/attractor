import { AbortError, ProviderError } from '../types/error.js';
import type { TimeoutConfig } from '../types/config.js';

export type FetchOptions = {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeout?: TimeoutConfig;
  readonly signal?: AbortSignal;
};

export type FetchResult = {
  readonly response: globalThis.Response;
  readonly body: unknown;
};

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

  // Check if external signal is already aborted
  if (externalSignal?.aborted) {
    throw new AbortError('Signal was already aborted');
  }

  // Create abort controller for timeout
  const timeoutController = new AbortController();

  // Link external signal to timeout controller
  const linkedSignal = linkSignals(externalSignal, timeoutController.signal);

  // Set up timeout if configured
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout?.requestMs) {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeout.requestMs);
  }

  try {
    // Merge headers
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    // Serialize body if provided
    const body = bodyData !== undefined ? JSON.stringify(bodyData) : undefined;

    // Perform fetch
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method,
        headers: mergedHeaders,
        body,
        signal: linkedSignal,
      });
    } catch (err) {
      // Convert native AbortError to SDK AbortError
      if (err instanceof globalThis.Error && err.name === 'AbortError') {
        throw new AbortError('Fetch was aborted');
      }
      throw err;
    }

    // Check for non-2xx status
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(
        `HTTP ${response.status}: ${text}`,
        response.status,
        false,
        'unknown',
        null,
        text,
      );
    }

    // Parse JSON body
    const parsedBody = await response.json();

    return {
      response,
      body: parsedBody,
    };
  } finally {
    // Clean up timeout
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

  // Check if external signal is already aborted
  if (externalSignal?.aborted) {
    throw new AbortError('Signal was already aborted');
  }

  // Create abort controller for timeout
  const timeoutController = new AbortController();

  // Link external signal to timeout controller
  const linkedSignal = linkSignals(externalSignal, timeoutController.signal);

  // Set up timeout if configured
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout?.requestMs) {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeout.requestMs);
  }

  try {
    // Merge headers
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    // Serialize body if provided
    const body = bodyData !== undefined ? JSON.stringify(bodyData) : undefined;

    // Perform fetch
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method,
        headers: mergedHeaders,
        body,
        signal: linkedSignal,
      });
    } catch (err) {
      // Convert native AbortError to SDK AbortError
      if (err instanceof globalThis.Error && err.name === 'AbortError') {
        throw new AbortError('Fetch was aborted');
      }
      throw err;
    }

    // Check for non-2xx status
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(
        `HTTP ${response.status}: ${text}`,
        response.status,
        false,
        'unknown',
        null,
        text,
      );
    }

    return response;
  } finally {
    // Clean up timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Links two abort signals so that either one being aborted triggers the target.
 */
function linkSignals(
  externalSignal: AbortSignal | undefined,
  targetSignal: AbortSignal,
): AbortSignal {
  if (!externalSignal) {
    return targetSignal;
  }

  if (externalSignal.aborted) {
    return externalSignal;
  }

  // Create a new controller that aborts when either signal aborts
  const controller = new AbortController();

  externalSignal.addEventListener('abort', () => controller.abort());
  targetSignal.addEventListener('abort', () => controller.abort());

  return controller.signal;
}
