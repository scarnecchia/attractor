# Unified LLM SDK Implementation Plan — Phase 2

**Goal:** Build the shared infrastructure that all provider adapters depend on: HTTP wrapper, SSE adapter, retry logic, error mapping, and JSON Schema helpers.

**Architecture:** Layer 2 (utils/) provides shared infrastructure imported by adapter authors. Application code generally does not import this layer directly.

**Tech Stack:** TypeScript 5.7, Vitest 4.0, eventsource-parser 3.0 (EventSourceParserStream from `eventsource-parser/stream`)

**Scope:** 7 phases from original design (phases 1-7). This is Phase 2.

**Codebase verified:** 2026-02-10. Phase 1 creates types/ layer. No utils/ directory exists yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### unified-llm-sdk.AC6: Error Handling
- **unified-llm-sdk.AC6.1 Success:** HTTP 401 -> AuthenticationError (retryable=false)
- **unified-llm-sdk.AC6.2 Success:** HTTP 429 -> RateLimitError (retryable=true)
- **unified-llm-sdk.AC6.3 Success:** HTTP 500 -> ServerError (retryable=true)
- **unified-llm-sdk.AC6.4 Success:** HTTP 404 -> NotFoundError (retryable=false)
- **unified-llm-sdk.AC6.5 Success:** Retry-After header parsed and set on error
- **unified-llm-sdk.AC6.6 Success:** Message-based classification for ambiguous status codes

### unified-llm-sdk.AC7: Retry
- **unified-llm-sdk.AC7.1 Success:** Exponential backoff with jitter follows correct curve
- **unified-llm-sdk.AC7.2 Success:** Retry-After header overrides backoff when within maxDelay
- **unified-llm-sdk.AC7.3 Success:** Retry-After exceeding maxDelay skips retry, raises immediately
- **unified-llm-sdk.AC7.4 Success:** max_retries=0 disables retries
- **unified-llm-sdk.AC7.5 Success:** Retries apply per-step, not whole multi-step operation
- **unified-llm-sdk.AC7.6 Success:** Streaming does not retry after partial data delivered

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: HTTP fetch wrapper

**Files:**
- Create: `packages/llm/src/utils/http.ts`

**Implementation:**

Create `packages/llm/src/utils/http.ts` providing a `fetchWithTimeout` function that wraps native `fetch()` with:

- **Timeout support:** Accept a `TimeoutConfig` (from types/config). Use `AbortController` internally. If the caller provides an external `signal`, link it so either the caller's abort OR the timeout triggers cancellation. Connect timeout fires first, then request timeout takes over after connection is established.
- **Default headers:** Accept a `headers` parameter (Record<string, string>), merge with `{ 'Content-Type': 'application/json' }`.
- **JSON body serialization:** Accept a `body` parameter (unknown), serialize with `JSON.stringify()` if provided.
- **Non-2xx detection:** After fetch completes, check `response.ok`. If false, read the response body as text, then throw the appropriate error from the error hierarchy (delegate to error-mapping.ts — for now just throw a generic `ProviderError`). The actual error mapping integration happens in Task 3.
- **Abort signal propagation:** If the caller's signal is already aborted, throw `AbortError` immediately. If aborted during fetch, catch the native `AbortError` and re-throw as the SDK's `AbortError`.

Function signature:
```typescript
type FetchOptions = {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeout?: TimeoutConfig;
  readonly signal?: AbortSignal;
};

type FetchResult = {
  readonly response: globalThis.Response;
  readonly body: unknown;
};

function fetchWithTimeout(options: FetchOptions): Promise<FetchResult>;
```

Also export a `fetchStream` variant that returns the raw `Response` (for streaming) instead of parsing JSON:
```typescript
function fetchStream(options: FetchOptions): Promise<globalThis.Response>;
```

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add HTTP fetch wrapper with timeout and abort support`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: HTTP fetch wrapper tests

**Verifies:** None directly — this is infrastructure supporting AC6/AC7.

**Files:**
- Create: `packages/llm/src/utils/http.test.ts`

**Testing:**

Test `fetchWithTimeout` and `fetchStream` by mocking `globalThis.fetch` with `vi.fn()`:

- **Successful JSON response:** Mock fetch returning `{ ok: true, json: () => ({...}) }`. Assert `fetchWithTimeout` returns parsed body.
- **Timeout triggers AbortError:** Mock fetch that never resolves. Pass `timeout: { requestMs: 50 }`. Assert throws `AbortError` (or `TimeoutError` — depends on how you model it) within ~50ms.
- **Caller abort signal propagated:** Create an `AbortController`, abort it before calling. Assert throws `AbortError` immediately.
- **Non-2xx status throws:** Mock fetch returning `{ ok: false, status: 500, text: () => 'Internal Server Error' }`. Assert throws `ProviderError` (or subclass).
- **Default headers merged:** Mock fetch, capture the `Request` passed to it, assert `Content-Type: application/json` is present.
- **Custom headers override defaults:** Pass custom `Content-Type`, assert it overrides the default.
- **fetchStream returns raw Response:** Mock fetch with `{ ok: true }`, assert `fetchStream` returns the Response object directly without parsing.

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/http.test.ts
```

Expected: All tests pass.

**Commit:** `test: add HTTP fetch wrapper tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Error mapping

**Verifies:** unified-llm-sdk.AC6.1, unified-llm-sdk.AC6.2, unified-llm-sdk.AC6.3, unified-llm-sdk.AC6.4, unified-llm-sdk.AC6.5, unified-llm-sdk.AC6.6

**Files:**
- Create: `packages/llm/src/utils/error-mapping.ts`

**Implementation:**

Create `packages/llm/src/utils/error-mapping.ts` with:

A `mapHttpError` function that takes `statusCode: number`, `body: string`, `provider: string`, `headers: Headers` and returns the appropriate `ProviderError` subclass:

| Status Code | Error Class | retryable |
|-------------|-------------|-----------|
| 400 | `InvalidRequestError` | false |
| 401 | `AuthenticationError` | false |
| 403 | `AccessDeniedError` | false |
| 404 | `NotFoundError` | false |
| 413 | `ContextLengthError` | false |
| 422 | `InvalidRequestError` | false |
| 429 | `RateLimitError` | true |
| 500+ | `ServerError` | true |

For ambiguous status codes (e.g., 400 that could be content filter vs validation vs bad request), use message-based classification: scan the `body` string for keywords like `"content_filter"`, `"content_policy"`, `"safety"` to determine if it's a `ContentFilterError`. Scan for `"context_length"`, `"too many tokens"`, `"maximum context"` to determine if it's a `ContextLengthError` (which may arrive as 400 from some providers instead of 413). Otherwise, map to `InvalidRequestError`.

A `parseRetryAfter` function that extracts `Retry-After` from response headers:
- If header is a number string, parse as seconds and return milliseconds
- If header is an HTTP date string, compute delta from now and return milliseconds
- If absent, return `null`

Set the `retryAfter` field on the returned error when applicable.

Function signatures:
```typescript
type MapHttpErrorOptions = {
  readonly statusCode: number;
  readonly body: string;
  readonly provider: string;
  readonly headers: Headers;
  readonly raw?: unknown;
};

function mapHttpError(options: MapHttpErrorOptions): ProviderError;
function parseRetryAfter(headers: Headers): number | null;
```

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add HTTP status to error class mapping with Retry-After parsing`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Error mapping tests

**Verifies:** unified-llm-sdk.AC6.1, unified-llm-sdk.AC6.2, unified-llm-sdk.AC6.3, unified-llm-sdk.AC6.4, unified-llm-sdk.AC6.5, unified-llm-sdk.AC6.6

**Files:**
- Create: `packages/llm/src/utils/error-mapping.test.ts`

**Testing:**

Tests for `mapHttpError`:
- unified-llm-sdk.AC6.1: Status 401 → `AuthenticationError` with `retryable === false`
- unified-llm-sdk.AC6.2: Status 429 → `RateLimitError` with `retryable === true`
- unified-llm-sdk.AC6.3: Status 500 → `ServerError` with `retryable === true`
- unified-llm-sdk.AC6.3 extended: Status 502, 503 → `ServerError` with `retryable === true`
- unified-llm-sdk.AC6.4: Status 404 → `NotFoundError` with `retryable === false`
- **Status 400 → `InvalidRequestError`** with `retryable === false`
- **Status 422 → `InvalidRequestError`** with `retryable === false`
- **Status 413 → `ContextLengthError`** with `retryable === false`
- **Status 403 → `AccessDeniedError`** with `retryable === false`
- unified-llm-sdk.AC6.6: Status 400 with body containing "content_filter" → `ContentFilterError`
- unified-llm-sdk.AC6.6: Status 400 with body containing "safety" → `ContentFilterError`
- unified-llm-sdk.AC6.6: Status 400 with body containing "context_length" → `ContextLengthError`
- unified-llm-sdk.AC6.6: Status 400 with generic body → `InvalidRequestError` (default for unclassified 400)

Tests for `parseRetryAfter`:
- unified-llm-sdk.AC6.5: Header with numeric value "30" → returns 30000 (ms)
- unified-llm-sdk.AC6.5: Header with HTTP date string → returns correct ms delta
- unified-llm-sdk.AC6.5: No Retry-After header → returns null

Integration test:
- Status 429 with `Retry-After: 60` header → `RateLimitError` with `retryAfter === 60000`

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/error-mapping.test.ts
```

Expected: All tests pass.

**Commit:** `test: add error mapping and Retry-After parsing tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: SSE stream adapter

**Files:**
- Create: `packages/llm/src/utils/sse.ts`

**Implementation:**

Create `packages/llm/src/utils/sse.ts` that wraps `eventsource-parser/stream` to produce an `AsyncIterable<SSEEvent>` from a fetch `Response.body` `ReadableStream`.

Define a local `SSEEvent` type:
```typescript
type SSEEvent = {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
};
```

Create an `createSSEStream` async generator function:
```typescript
async function* createSSEStream(response: globalThis.Response): AsyncIterable<SSEEvent>
```

Implementation approach:
1. Get the `ReadableStream` from `response.body`
2. Pipe it through `EventSourceParserStream` from `eventsource-parser/stream`
3. Read from the resulting stream using `getReader()`
4. Yield each parsed event as an `SSEEvent`
5. Handle stream completion and errors (throw `SDKError` on unexpected stream termination)

Export `SSEEvent` type and `createSSEStream` function.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add SSE stream adapter wrapping eventsource-parser`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: SSE stream adapter tests

**Verifies:** None directly — infrastructure for streaming in AC5.4, AC5.5.

**Files:**
- Create: `packages/llm/src/utils/sse.test.ts`

**Testing:**

Create a helper that builds a mock `Response` with a `ReadableStream` body from an array of SSE-formatted strings (e.g., `"event: message\ndata: {\"text\":\"hello\"}\n\n"`).

Tests:
- **Single event parsing:** Feed one SSE event → yields one `SSEEvent` with correct `event` and `data` fields
- **Multiple events:** Feed 3 events → yields 3 `SSEEvent` objects in order
- **Multi-line data:** Feed event with multi-line `data:` fields → `data` concatenated with newlines
- **Event type field:** Feed `event: delta\ndata: test\n\n` → yields `{ event: 'delta', data: 'test' }`
- **Default event type:** Feed `data: test\n\n` (no explicit event type) → yields with event `''` or `'message'` (depends on eventsource-parser behaviour)
- **Stream completion:** After all events consumed, async iteration completes normally
- **Empty data lines:** Feed `data:\n\n` → yields event with empty data string

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/sse.test.ts
```

Expected: All tests pass.

**Commit:** `test: add SSE stream adapter tests`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Retry logic

**Verifies:** unified-llm-sdk.AC7.1, unified-llm-sdk.AC7.2, unified-llm-sdk.AC7.3, unified-llm-sdk.AC7.4

**Files:**
- Create: `packages/llm/src/utils/retry.ts`

**Implementation:**

Create `packages/llm/src/utils/retry.ts` with a `retry` utility function:

```typescript
type RetryOptions = {
  readonly policy: RetryPolicy;
  readonly onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
};

async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T>;
```

Implementation:
1. Call `fn()`. If it succeeds, return the result.
2. If it throws a `ProviderError` with `retryable === true`:
   a. Check if attempts remaining (`attempt < policy.maxRetries`). If `maxRetries === 0`, re-throw immediately (AC7.4).
   b. Calculate delay: `min(initialDelayMs * backoffMultiplier^attempt, maxDelayMs)` plus jitter (random 0-25% of delay) (AC7.1).
   c. If the error has `retryAfter` set:
      - If `retryAfter <= maxDelayMs`, use `retryAfter` as the delay instead of calculated backoff (AC7.2).
      - If `retryAfter > maxDelayMs`, skip retry entirely and re-throw immediately (AC7.3).
   d. Call `onRetry` callback if provided.
   e. Wait for the delay, then call `fn()` again.
3. If it throws a non-retryable error, re-throw immediately.
4. If max retries exhausted, re-throw the last error.

Also export a `calculateBackoff` function for testing:
```typescript
function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
): number;
```

The jitter should be applied separately so `calculateBackoff` is deterministic (testable) and jitter is added in `retry()`.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add retry utility with exponential backoff and jitter`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Retry logic tests

**Verifies:** unified-llm-sdk.AC7.1, unified-llm-sdk.AC7.2, unified-llm-sdk.AC7.3, unified-llm-sdk.AC7.4

**Files:**
- Create: `packages/llm/src/utils/retry.test.ts`

**Testing:**

Use `vi.useFakeTimers()` to control time in retry tests. Create helper to make a mock function that fails N times then succeeds.

Tests for `calculateBackoff`:
- unified-llm-sdk.AC7.1: attempt 0 with initialDelayMs=100, multiplier=2 → 100
- unified-llm-sdk.AC7.1: attempt 1 → 200
- unified-llm-sdk.AC7.1: attempt 2 → 400
- unified-llm-sdk.AC7.1: attempt 3 with maxDelayMs=500 → 500 (capped)

Tests for `retry`:
- unified-llm-sdk.AC7.4: `maxRetries=0` → fn called once, error thrown immediately on failure, no retry
- **Success on first try:** fn succeeds → returns result, fn called exactly once
- **Success after retries:** fn fails twice (retryable ServerError), succeeds third time → returns result
- **Non-retryable error:** fn throws `AuthenticationError` → re-throws immediately, fn called once
- **Max retries exhausted:** fn always fails with retryable error, `maxRetries=2` → fn called 3 times (1 initial + 2 retries), throws last error
- unified-llm-sdk.AC7.2: fn throws `RateLimitError` with `retryAfter=500` and `maxDelayMs=1000` → waits 500ms (not calculated backoff)
- unified-llm-sdk.AC7.3: fn throws `RateLimitError` with `retryAfter=5000` and `maxDelayMs=1000` → re-throws immediately without retrying
- **onRetry callback called:** Verify callback receives (error, attempt, delayMs) on each retry

Tests for jitter:
- unified-llm-sdk.AC7.1: Run retry multiple times with same config → delays are not identical (jitter adds randomness). Use `vi.spyOn(Math, 'random')` to control jitter and verify it's applied.

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/retry.test.ts
```

Expected: All tests pass.

**Commit:** `test: add retry logic tests with backoff, jitter, and Retry-After`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (tasks 9-10) -->
<!-- START_TASK_9 -->
### Task 9: JSON Schema helpers

**Files:**
- Create: `packages/llm/src/utils/json-schema.ts`

**Implementation:**

Create `packages/llm/src/utils/json-schema.ts` with utility functions for working with JSON Schema in the context of tool parameters and structured output:

- `validateJsonSchema(schema: Record<string, unknown>): boolean` — Basic structural validation that a schema object looks like valid JSON Schema (has `type` field, properties are well-formed). Not a full JSON Schema validator — just enough to catch obvious errors before sending to providers.
- `wrapSchemaForOpenAI(schema: Record<string, unknown>, name: string): Record<string, unknown>` — Wraps a schema in the format OpenAI expects for `json_schema` response format: `{ type: 'json_schema', json_schema: { name, schema, strict: true } }`.
- `createExtractionTool(schema: Record<string, unknown>): Tool` — Creates a synthetic tool definition for Anthropic's tool-based extraction strategy. Tool name is `'__extract'`, parameters are the provided schema.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add JSON Schema helpers for structured output`
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: JSON Schema helper tests

**Verifies:** None directly — infrastructure for AC11 (structured output).

**Files:**
- Create: `packages/llm/src/utils/json-schema.test.ts`

**Testing:**

Tests for `validateJsonSchema`:
- Valid schema with `type: 'object'` and `properties` → returns true
- Schema missing `type` → returns false
- Empty object → returns false

Tests for `wrapSchemaForOpenAI`:
- Wraps schema correctly: output has `type: 'json_schema'`, `json_schema.name` matches input name, `json_schema.schema` matches input schema, `json_schema.strict` is true

Tests for `createExtractionTool`:
- Returns a `Tool` with `name: '__extract'`
- `parameters` matches the input schema
- No `execute` function (passive tool)

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/json-schema.test.ts
```

Expected: All tests pass.

**Commit:** `test: add JSON Schema helper tests`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_TASK_11 -->
### Task 11: Utils barrel export and full test run

**Files:**
- Create: `packages/llm/src/utils/index.ts`
- Modify: `packages/llm/src/index.ts` (add utils re-export)

**Step 1: Create utils barrel export**

Create `packages/llm/src/utils/index.ts` re-exporting from:
- `./http.js`
- `./sse.js`
- `./error-mapping.js`
- `./retry.js`
- `./json-schema.js`

**Step 2: Verify root barrel does NOT re-export utils**

The `utils/` layer is internal infrastructure used by adapters and the client layer. It should NOT be re-exported from the root `packages/llm/src/index.ts`. Consumer code uses the high-level api/ and client/ layers. If utils functions are needed externally, export them individually from the root barrel later — but do not blanket re-export all of utils.

Verify `packages/llm/src/index.ts` does NOT contain `export * from './utils/index.js'`.

**Step 3: Run full test suite**

```bash
cd packages/llm && npm test
```

Expected: All Phase 2 tests pass (http, sse, error-mapping, retry, json-schema).

**Step 4: Run build**

```bash
cd packages/llm && npm run build
```

Expected: Build succeeds with utils/ added to dist/.

**Step 5: Commit**

```bash
git add packages/llm/src/utils/index.ts packages/llm/src/index.ts
git commit -m "feat: add utils barrel export, verify full test suite"
```
<!-- END_TASK_11 -->
