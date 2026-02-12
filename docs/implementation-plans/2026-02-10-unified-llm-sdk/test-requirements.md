# Unified LLM SDK Test Requirements

Traceability matrix mapping every acceptance criterion to automated tests or documented human verification.

**Generated:** 2026-02-10
**Source design:** `docs/design-plans/2026-02-09-unified-llm-sdk.md`
**Source implementation plans:** `phase_01.md` through `phase_07.md`

---

## Legend

| Column | Description |
|--------|-------------|
| AC ID | Acceptance criterion identifier from the design plan |
| Description | Criterion description (success/failure condition) |
| Test Type | `unit`, `integration`, `e2e`, or `human` |
| Test File Path | Relative to `packages/llm/` |
| Phase | Implementation phase that delivers this test |

---

## AC1: Client Setup & Configuration

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC1.1 | `Client.fromEnv()` registers adapters for all providers whose API keys are present | unit | `src/client/client.test.ts` | 3 |
| AC1.2 | Client constructed programmatically routes to named provider | unit | `src/client/client.test.ts` | 3 |
| AC1.3 | Default provider used when request omits provider field | unit | `src/client/client.test.ts` | 3 |
| AC1.4 | `ConfigurationError` raised when no provider configured and no default set | unit | `src/client/client.test.ts` | 3 |
| AC1.5 | Module-level default client lazy-initializes from env on first use | unit | `src/client/default-client.test.ts` | 3 |
| AC1.6 | `setDefaultClient()` overrides the lazy-initialized client | unit | `src/client/default-client.test.ts` | 3 |

### Test Detail

- **AC1.1:** Mock env vars via `vi.stubEnv()`. Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`. Call `Client.fromEnv()` with mock adapter factories. Assert all three adapters registered. Then test with only `ANTHROPIC_API_KEY` set and assert only anthropic adapter registered. Also verify empty-string env vars are excluded.
- **AC1.2:** Construct Client with two mock adapters (`openai`, `anthropic`). Call `complete({ model: 'gpt-4', provider: 'openai' })` and verify openai adapter called. Call with `provider: 'anthropic'` and verify anthropic adapter called.
- **AC1.3:** Construct Client with `defaultProvider: 'openai'`. Call `complete({ model: 'gpt-4' })` (no provider). Assert openai adapter called. Also test: single provider registered with no explicit default uses that provider automatically.
- **AC1.4:** Construct Client with no providers. Call `complete()`. Assert `ConfigurationError` thrown. Also test: request specifies unknown provider name.
- **AC1.5:** Reset default client in `beforeEach`. First call to `getDefaultClient()` with env vars set creates and returns client. Second call returns same cached instance.
- **AC1.6:** Call `setDefaultClient(customClient)`. Assert `getDefaultClient()` returns customClient. Also test override of lazy-initialized client.

---

## AC2: Middleware

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC2.1 | Middleware executes in registration order for request phase | unit | `src/client/middleware.test.ts` | 3 |
| AC2.2 | Middleware executes in reverse order for response phase | unit | `src/client/middleware.test.ts` | 3 |
| AC2.3 | Middleware wraps streaming calls (can observe/transform events) | unit | `src/client/middleware.test.ts` | 3 |
| AC2.4 | Multiple middleware compose correctly (onion model) | unit | `src/client/middleware.test.ts` | 3 |

### Test Detail

- **AC2.1-AC2.2:** Two middleware push to a shared log array (`mw1-before`, `mw2-before`, `handler`, `mw2-after`, `mw1-after`). Assert request-phase order is `[mw1-before, mw2-before, handler]` and response-phase order is `[handler, mw2-after, mw1-after]`.
- **AC2.3:** Mock handler returns async generator of `StreamEvent`. Middleware iterates the `AsyncIterable` returned by `next()`, observing events. Assert middleware sees all stream events.
- **AC2.4:** Three middleware compose correctly. Full onion: `mw1-before, mw2-before, mw3-before, handler, mw3-after, mw2-after, mw1-after`. Also test request modification (middleware adds to `providerOptions` before `next()`, handler receives modified request) and empty middleware array (handler called directly).

---

## AC3: Provider Adapters

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC3.1 | OpenAI adapter uses Responses API, not Chat Completions | unit | `src/providers/openai/openai.test.ts` | 4 |
| AC3.2 | Anthropic adapter uses Messages API with correct headers (`x-api-key`, `anthropic-version`) | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC3.3 | Gemini adapter uses native API with `?alt=sse` for streaming | unit | `src/providers/gemini/gemini.test.ts` | 4 |
| AC3.4 | OpenAI-compatible adapter uses Chat Completions for third-party endpoints | unit | `src/providers/openai-compatible/openai-compatible.test.ts` | 4 |
| AC3.5 | All adapters translate all 5 roles correctly | unit | `src/providers/{openai,anthropic,gemini,openai-compatible}/*.test.ts` | 4 |
| AC3.6 | `provider_options` escape hatch passes through provider-specific params | unit | `src/providers/{openai,anthropic,gemini,openai-compatible}/*.test.ts` | 4 |
| AC3.7 | Anthropic beta headers passed via `provider_options` | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |

### Test Detail

- **AC3.1:** Mock `globalThis.fetch`. Assert request URL is `/v1/responses` (not `/v1/chat/completions`).
- **AC3.2:** Assert request headers contain `x-api-key` and `anthropic-version: 2023-06-01`.
- **AC3.3:** Assert streaming URL uses `:streamGenerateContent?key=...&alt=sse`. Blocking URL uses `:generateContent?key=...`.
- **AC3.4:** Assert URL uses `/v1/chat/completions`. Assert custom `baseUrl` is used, not OpenAI's URL.
- **AC3.5:** Per adapter: system message maps to correct provider format (instructions/system param/systemInstruction/system role), user/assistant/tool/developer roles all translate correctly. Anthropic tests also verify message alternation merging.
- **AC3.6:** Per adapter: `providerOptions.{provider}` keys are spread into request body.
- **AC3.7:** `providerOptions.anthropic.betaHeaders` merged into `anthropic-beta` header (comma-appended if header already exists).

---

## AC4: Message & Content Model

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC4.1 | Text-only messages work across all providers | unit | `src/providers/{openai,anthropic,gemini,openai-compatible}/*.test.ts` | 4 |
| AC4.2 | Image input as base64 data translated correctly per provider | unit | `src/providers/{openai,anthropic,gemini}/*.test.ts` | 4 |
| AC4.3 | Image input as URL translated correctly per provider | unit | `src/providers/{openai,anthropic,gemini}/*.test.ts` | 4 |
| AC4.4 | Image input as local file path reads, base64-encodes, and sends | unit | `src/utils/image.test.ts` | 4 |
| AC4.5 | Tool call content parts round-trip (assistant tool calls -> tool results -> next response) | unit | `src/providers/{openai,anthropic,gemini,openai-compatible}/*.test.ts` | 4 |
| AC4.6 | Anthropic thinking blocks preserved with signatures intact | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC4.7 | Redacted thinking blocks passed through verbatim | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC4.8 | Multimodal messages (text + images) work | unit | `src/api/multimodal.test.ts` | 5 |

### Test Detail

- **AC4.1:** Per adapter: text-only user message translates to correct provider-specific format.
- **AC4.2:** OpenAI: base64 image becomes `input_image` with data URI. Anthropic: `source.type: 'base64'`. Gemini: `inlineData` part.
- **AC4.3:** OpenAI: URL image becomes `input_image` with url. Anthropic: `source.type: 'url'`. Gemini: `fileData` with `fileUri`.
- **AC4.4:** Create temp PNG file, pass path. Assert `resolveImageContent()` returns `ImageData` with base64 data and `image/png` mediaType. Also test: existing base64/URL images returned unchanged. Non-image content parts returned unchanged.
- **AC4.5:** Per adapter: response with tool call parsed correctly (ToolCallData with id, name, args). Request with tool result formatted correctly per provider format. Gemini: synthetic UUID maps back to function name.
- **AC4.6:** Anthropic response with `type: 'thinking'` block returns `ThinkingData` with `text` and `signature` fields intact.
- **AC4.7:** Anthropic response with `type: 'redacted_thinking'` block returns `RedactedThinkingData` with `data` field verbatim.
- **AC4.8:** User message with text + base64 image content parts passes through correctly to mock client. Also test text + URL image.

---

## AC5: Generation

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC5.1 | `generate()` with simple text prompt returns text response | unit | `src/api/generate.test.ts` | 5 |
| AC5.2 | `generate()` with full messages list works | unit | `src/api/generate.test.ts` | 5 |
| AC5.3 | `generate()` with both prompt and messages raises error | unit | `src/api/generate.test.ts` | 5 |
| AC5.4 | `stream()` yields `TEXT_DELTA` events that concatenate to full response | unit | `src/api/stream.test.ts` | 5 |
| AC5.5 | `stream()` yields `STREAM_START` and `FINISH` with correct metadata | unit | `src/api/stream.test.ts` | 5 |
| AC5.6 | `StreamAccumulator` produces response equivalent to `complete()` | unit | `src/api/stream.test.ts` | 5 |
| AC5.7 | Abort signal cancels in-flight request, raises `AbortError` | unit | `src/api/generate.test.ts` | 5 |
| AC5.8 | Timeouts work (total and per-step) | unit | `src/api/generate.test.ts` | 5 |

### Test Detail

- **AC5.1:** `generate({ model: 'test', prompt: 'hello' })` with mock client. Assert `client.complete` called with user message containing "hello". Assert result has text.
- **AC5.2:** `generate({ model: 'test', messages: [...] })`. Assert `client.complete` called with provided messages array.
- **AC5.3:** `generate({ model: 'test', prompt: 'x', messages: [...] })`. Assert throws `ValidationError`.
- **AC5.4:** Mock client stream yields `TEXT_DELTA` events with "hel", "lo". Collect and join. Assert equals "hello".
- **AC5.5:** Assert first event is `STREAM_START` with `id` and `model`. Assert last event is `FINISH` with `finishReason` and `usage`.
- **AC5.6:** Consume stream through `StreamAccumulator`. Call `toResponse()`. Assert response has same text content, finish reason, and usage as a canned `complete()` response.
- **AC5.7:** Pass already-aborted `AbortSignal`. Assert throws `AbortError`.
- **AC5.8:** Mock `client.complete` that delays. Pass tight timeout. Assert throws timeout error.

---

## AC6: Error Handling

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC6.1 | HTTP 401 -> `AuthenticationError` (`retryable=false`) | unit | `src/utils/error-mapping.test.ts` | 2 |
| AC6.2 | HTTP 429 -> `RateLimitError` (`retryable=true`) | unit | `src/utils/error-mapping.test.ts` | 2 |
| AC6.3 | HTTP 500 -> `ServerError` (`retryable=true`) | unit | `src/utils/error-mapping.test.ts` | 2 |
| AC6.4 | HTTP 404 -> `NotFoundError` (`retryable=false`) | unit | `src/utils/error-mapping.test.ts` | 2 |
| AC6.5 | `Retry-After` header parsed and set on error | unit | `src/utils/error-mapping.test.ts` | 2 |
| AC6.6 | Message-based classification for ambiguous status codes | unit | `src/utils/error-mapping.test.ts` | 2 |

### Test Detail

- **AC6.1:** `mapHttpError({ statusCode: 401, ... })` returns `AuthenticationError` with `retryable === false`.
- **AC6.2:** `mapHttpError({ statusCode: 429, ... })` returns `RateLimitError` with `retryable === true`.
- **AC6.3:** `mapHttpError({ statusCode: 500, ... })` returns `ServerError` with `retryable === true`. Also test 502, 503.
- **AC6.4:** `mapHttpError({ statusCode: 404, ... })` returns `NotFoundError` with `retryable === false`.
- **AC6.5:** `parseRetryAfter` with numeric string "30" returns 30000ms. HTTP date string returns correct delta. Absent header returns null. Integration: status 429 with `Retry-After: 60` header produces `RateLimitError` with `retryAfter === 60000`.
- **AC6.6:** Status 400 with body containing "content_filter" returns `ContentFilterError`. Body containing "safety" returns `ContentFilterError`. Body containing "context_length" returns `ContextLengthError`. Generic 400 body returns `InvalidRequestError`.

---

## AC7: Retry

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC7.1 | Exponential backoff with jitter follows correct curve | unit | `src/utils/retry.test.ts` | 2 |
| AC7.2 | `Retry-After` header overrides backoff when within `maxDelay` | unit | `src/utils/retry.test.ts` | 2 |
| AC7.3 | `Retry-After` exceeding `maxDelay` skips retry, raises immediately | unit | `src/utils/retry.test.ts` | 2 |
| AC7.4 | `max_retries=0` disables retries | unit | `src/utils/retry.test.ts` | 2 |
| AC7.5 | Retries apply per-step, not whole multi-step operation | unit | `src/api/generate.test.ts` | 5 |
| AC7.6 | Streaming does not retry after partial data delivered | unit | `src/api/stream.test.ts` | 5 |

### Test Detail

- **AC7.1:** `calculateBackoff` with `initialDelayMs=100, multiplier=2`: attempt 0 returns 100, attempt 1 returns 200, attempt 2 returns 400, attempt 3 with `maxDelayMs=500` returns 500 (capped). Jitter test: mock `Math.random`, verify jitter adds 0-25% of delay.
- **AC7.2:** fn throws `RateLimitError` with `retryAfter=500`, `maxDelayMs=1000`. Assert delay is 500ms (not calculated backoff).
- **AC7.3:** fn throws `RateLimitError` with `retryAfter=5000`, `maxDelayMs=1000`. Assert re-throws immediately without retrying.
- **AC7.4:** `maxRetries=0`. fn fails once. Assert fn called exactly once, error thrown immediately.
- **AC7.5:** Tested in `generate.test.ts`: multi-step tool loop with retry configured. Each step retries independently on transient failures. A retry in step 2 does not reset step 1.
- **AC7.6:** Tested in `stream.test.ts`: stream yields partial data then errors. Assert no retry attempted after partial delivery.

---

## AC8: Prompt Caching

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC8.1 | Anthropic adapter auto-injects `cache_control` on system, tools, last user message | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC8.2 | Anthropic adapter auto-includes prompt-caching beta header | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC8.3 | Auto-caching disabled via `providerOptions.anthropic.autoCache=false` | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC8.4 | `Usage.cacheReadTokens` populated for all three providers | unit | `src/providers/{openai,anthropic,gemini}/*.test.ts` | 4 |
| AC8.5 | `Usage.cacheWriteTokens` populated for Anthropic | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC8.6 | Multi-turn session shows >50% cache hits on turn 2+ | integration | `tests/integration/caching.test.ts` | 7 |

### Test Detail

- **AC8.1:** Mock fetch. Assert request body has `cache_control: { type: 'ephemeral' }` on: last content block of system array, last tool definition, last content block of last user message.
- **AC8.2:** Assert request headers include `prompt-caching-2024-07-31` in `anthropic-beta`.
- **AC8.3:** Pass `providerOptions.anthropic.autoCache = false`. Assert no `cache_control` annotations in request body.
- **AC8.4:** OpenAI: `usage.prompt_tokens_details.cached_tokens` maps to `cacheReadTokens`. Anthropic: `cache_read_input_tokens` maps to `cacheReadTokens`. Gemini: `usageMetadata.cachedContentTokenCount` maps to `cacheReadTokens`.
- **AC8.5:** Anthropic response with `cache_creation_input_tokens` maps to `cacheWriteTokens`.
- **AC8.6:** Integration test with real Anthropic API. Send large system prompt (~2000 tokens) + short user message (turn 1). Send same system prompt + different user message (turn 2). Assert `turn2.usage.cacheReadTokens > 0`. Assert turn 1 `cacheWriteTokens > 0`.

---

## AC9: Reasoning Tokens

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC9.1 | OpenAI `reasoning_tokens` in Usage via Responses API | unit | `src/providers/openai/openai.test.ts` | 4 |
| AC9.2 | `reasoning_effort` parameter passed through to OpenAI | unit | `src/providers/openai/openai.test.ts` | 4 |
| AC9.3 | Anthropic thinking blocks returned as `THINKING` content parts | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC9.4 | Thinking block signatures preserved for round-tripping | unit | `src/providers/anthropic/anthropic.test.ts` | 4 |
| AC9.5 | Gemini `thoughtsTokenCount` mapped to `reasoning_tokens` | unit | `src/providers/gemini/gemini.test.ts` | 4 |

### Test Detail

- **AC9.1:** Mock OpenAI response with `usage.reasoning_tokens: 42`. Assert translated `usage.reasoningTokens === 42`.
- **AC9.2:** Pass `providerOptions.openai.reasoning_effort = 'high'`. Assert it appears in the request body.
- **AC9.3:** Anthropic response with `type: 'thinking'` content block. Assert result has `ThinkingData` content part with `kind: 'THINKING'`.
- **AC9.4:** Thinking block with `signature: 'abc123'` in response. Assert `ThinkingData.signature === 'abc123'`. Also verify: thinking block in request translation preserves signature for continuation.
- **AC9.5:** Gemini response with `usageMetadata.thoughtsTokenCount: 15`. Assert `usage.reasoningTokens === 15`.

---

## AC10: Tool Calling

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC10.1 | Active tools trigger automatic execution loop | unit | `src/api/generate.test.ts` | 5 |
| AC10.2 | Passive tools return tool calls without looping | unit | `src/api/generate.test.ts` | 5 |
| AC10.3 | `max_tool_rounds` respected | unit | `src/api/generate.test.ts` | 5 |
| AC10.4 | `max_tool_rounds=0` disables automatic execution | unit | `src/api/generate.test.ts` | 5 |
| AC10.5 | Parallel tool calls executed concurrently via `Promise.allSettled` | unit | `src/api/generate.test.ts` | 5 |
| AC10.6 | All parallel results sent in single continuation request | unit | `src/api/generate.test.ts` | 5 |
| AC10.7 | Tool execution error sent as `is_error` result, not exception | unit | `src/api/generate.test.ts` | 5 |
| AC10.8 | Unknown tool call sends error result, not exception | unit | `src/api/generate.test.ts` | 5 |
| AC10.9 | `ToolChoice` modes (auto, none, required, named) translated per provider | unit | `src/api/generate.test.ts` + `src/providers/{openai,anthropic,gemini,openai-compatible}/*.test.ts` | 4, 5 |
| AC10.10 | `StepResult` tracks each step's calls, results, and usage | unit | `src/api/generate.test.ts` | 5 |

### Test Detail

- **AC10.1:** Mock client returns response with tool call. Active tool (has `execute`) returns "result". Assert `client.complete` called twice (original + continuation). Final response is text.
- **AC10.2:** Mock client returns response with tool call. Passive tool (no `execute`). Assert returns immediately with `toolCalls` populated, `client.complete` called only once.
- **AC10.3:** `maxToolRounds: 2`. Model keeps requesting tools. Assert loop stops after 2 rounds.
- **AC10.4:** `maxToolRounds: 0`. Assert tool calls not executed even with active tools.
- **AC10.5:** Response with 3 parallel tool calls. All 3 tools have `execute`. Assert all 3 execute (verify via mock call counts). Verify concurrent execution via timing or `Promise.allSettled` usage.
- **AC10.6:** 3 parallel results. Assert single continuation request contains all 3 tool result messages.
- **AC10.7:** Active tool's `execute` throws. Assert tool result in continuation has `isError: true` with error message. Assert no exception propagated to caller.
- **AC10.8:** Response references tool name not in tools array. Assert tool result with `isError: true`, message contains "Unknown tool". Assert no exception propagated.
- **AC10.9:** Phase 4 tests verify per-provider translation (auto/none/required/named to provider format). Phase 5 test verifies `toolChoice` passes through from `generate()` to `client.complete()`.
- **AC10.10:** Multi-step tool loop. Assert `result.steps` has correct count. Each step has `usage`, `toolCalls`, `toolResults`.

---

## AC11: Structured Output

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC11.1 | `generateObject()` with OpenAI uses native `json_schema` | unit | `src/api/generate-object.test.ts` | 6 |
| AC11.2 | `generateObject()` with Gemini uses native `responseSchema` | unit | `src/api/generate-object.test.ts` | 6 |
| AC11.3 | `generateObject()` with Anthropic uses tool-based extraction | unit | `src/api/generate-object.test.ts` | 6 |
| AC11.4 | `generateObject()` returns parsed, validated output | unit | `src/api/generate-object.test.ts` | 6 |
| AC11.5 | `generateObject()` raises `NoObjectGeneratedError` on parse failure | unit | `src/api/generate-object.test.ts` | 6 |
| AC11.6 | `streamObject()` yields progressively larger partial objects | unit | `src/api/stream-object.test.ts` | 6 |
| AC11.7 | `streamObject()` final object validates against schema | unit | `src/api/stream-object.test.ts` | 6 |

### Test Detail

- **AC11.1:** OpenAI provider. Assert request has `responseFormat` with `type: 'json_schema'`, `json_schema.strict: true`. Response text parsed as JSON, returned as object.
- **AC11.2:** Gemini provider. Assert request has `generationConfig.responseSchema` and `responseMimeType: 'application/json'`.
- **AC11.3:** Anthropic provider. Assert request has `__extract` tool added. `toolChoice` is `{ mode: 'named', toolName: '__extract' }`. Tool call arguments parsed as output.
- **AC11.4:** Valid JSON with all schema fields. Assert returned object has correct types and values.
- **AC11.5:** Response with invalid JSON. Assert throws `NoObjectGeneratedError` with `raw` field. Also: valid JSON but missing required field throws `NoObjectGeneratedError`.
- **AC11.6:** Mock stream yields TEXT_DELTA events with partial JSON chunks (`{"na`, `me": "Ali`, `ce", "ag`, `e": 30}`). Assert progressively larger partial objects yielded (e.g., `{ name: "Ali" }`, then `{ name: "Alice" }`, then `{ name: "Alice", age: 30 }`). Assert de-duplication (identical partials not re-yielded). Also test Anthropic variant with `TOOL_CALL_DELTA` events.
- **AC11.7:** After stream completes, `object()` returns fully validated object. If final JSON is malformed, `object()` throws `NoObjectGeneratedError`.

---

## AC12: Cross-Provider Parity

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC12.1 | Spec Section 8.9 parity matrix -- all cells pass for all 3 providers | integration | `tests/integration/parity-matrix.test.ts` | 7 |

### Test Detail

**AC12.1** runs each of the following test cases against OpenAI, Anthropic, and Gemini using `describeForEachProvider`. Providers without API keys are skipped via `skipIfNoKey()`. All tests use low `maxTokens` (50-100) to minimize cost.

| Parity Matrix Cell | What is Verified |
|--------------------|------------------|
| Simple generation | `generate({ prompt: 'Say hello' })` returns non-empty text |
| Streaming | `stream({ prompt: 'Count to 3' })` yields `STREAM_START`, at least one `TEXT_DELTA`, and `FINISH` |
| Image input (base64) | `generate()` with user message containing text + base64 image returns text |
| Image input (URL) | `generate()` with user message containing text + URL image returns text |
| Single tool call | Active `get_weather` tool called, loop completes, final response references weather |
| Parallel tool calls | Two tools, prompt requiring both, both called via `Promise.allSettled`, single continuation |
| Multi-step tool loop | Tool requiring 2+ rounds, loop executes multiple steps |
| Streaming with tools | Tool test via `stream()`, yields tool events and `STEP_FINISH` |
| Structured output | `generateObject()` with schema returns valid object |
| Error handling (invalid key) | Invalid API key throws `AuthenticationError` |
| Usage accuracy | `generate()` returns `totalUsage.inputTokens > 0` and `outputTokens > 0` |
| Provider options passthrough | Provider-specific option passed without error |
| Rate limit error handling | Crafted to trigger rate limiting, throws `RateLimitError` |

Provider-specific additional cells:
- **OpenAI:** Reasoning tokens present for o-series models (if available)
- **Anthropic:** Thinking blocks present when extended thinking enabled
- **Gemini:** `thoughtsTokenCount` mapped when using thinking-capable model

---

## AC13: Integration Smoke Test

| AC ID | Description | Test Type | Test File Path | Phase |
|-------|-------------|-----------|----------------|-------|
| AC13.1 | Spec Section 8.10 end-to-end test passes against real APIs | e2e | `tests/integration/smoke.test.ts` | 7 |

### Test Detail

**AC13.1** is a sequential end-to-end scenario exercising the full stack against the first available real provider:

| Scenario | Verification |
|----------|-------------|
| Basic generation (all providers) | `generate({ prompt: 'What is 2+2?' })` response contains "4" |
| Streaming verification | `stream({ prompt: 'Count from 1 to 5' })` TEXT_DELTAs concatenate to something containing "1"-"5" |
| Image input | `generate()` with text + base64 image returns non-empty description |
| Tool calling (parallel) | `add(a, b)` and `multiply(a, b)` tools, prompt "What is 3+4 and 2*5?" Both called, results "7" and "10" in final response |
| Structured output | `generateObject({ schema: PersonSchema, prompt: 'Generate Alice age 30' })` returns `{ name: 'Alice', age: 30 }` |
| Error handling | Invalid API key throws `AuthenticationError` (verify `instanceof`) |

---

## Human Verification

The following criteria cannot be fully automated and require documented human verification:

| AC ID | Description | Justification | Verification Approach |
|-------|-------------|---------------|----------------------|
| AC8.6 | Multi-turn session shows >50% cache hits on turn 2+ | Cache behaviour depends on provider-side timing and minimum token thresholds. Anthropic caching requires ~1024+ tokens to activate, and cache TTL is 5 minutes. The integration test at `tests/integration/caching.test.ts` automates the assertion, but a transient infrastructure issue or cold-start can cause false negatives. | **Primary:** Automated integration test asserts `cacheReadTokens > 0` on turn 2. **Fallback:** If the automated test is flaky, a human runs the test manually with `ANTHROPIC_API_KEY` set, inspects the raw usage output, and confirms `cache_read_input_tokens` is a significant proportion of the system prompt token count. Document the result in the test run report. |
| AC12.1 | Spec Section 8.9 parity matrix -- all cells pass for all 3 providers | Requires valid API keys for all 3 providers simultaneously. CI environments may not have all keys. Rate limits or model availability changes can cause transient failures unrelated to SDK correctness. | **Primary:** Automated integration test suite. **Fallback:** Human runs `npm run test:integration -- parity-matrix.test.ts` with all 3 API keys set. Inspects test output. Any skip or failure is investigated manually. Parity matrix results are recorded in a test report matrix showing pass/skip/fail per provider per cell. |
| AC13.1 | Spec Section 8.10 end-to-end smoke test passes against real APIs | Requires real API key. LLM output is non-deterministic -- assertions like "response contains '4'" may intermittently fail if the model produces unexpected output. | **Primary:** Automated smoke test with lenient assertions (contains substring rather than exact match, allows for conversational preamble). **Fallback:** Human runs `npm run test:integration -- smoke.test.ts`, reviews output for semantic correctness if assertion fails. Retries once on non-deterministic failure before flagging as real issue. |

### Notes on Human Verification Scope

All 68 acceptance criteria map to automated tests. The three entries above are criteria where automated tests exist but may require human judgement for edge cases:

1. **Flaky integration tests** (AC8.6, AC12.1, AC13.1) are not a coverage gap -- the automation exists. Human review is the fallback when non-deterministic external factors cause test instability.
2. No criterion is *exclusively* human-verified. Every AC has at least one automated test.

---

## Test File Summary

| Test File (relative to `packages/llm/`) | Type | Phase | ACs Covered |
|------------------------------------------|------|-------|-------------|
| `src/utils/http.test.ts` | unit | 2 | (infrastructure) |
| `src/utils/error-mapping.test.ts` | unit | 2 | AC6.1-AC6.6 |
| `src/utils/sse.test.ts` | unit | 2 | (infrastructure) |
| `src/utils/retry.test.ts` | unit | 2 | AC7.1-AC7.4 |
| `src/utils/json-schema.test.ts` | unit | 2 | (infrastructure) |
| `src/utils/image.test.ts` | unit | 4 | AC4.4 |
| `src/client/config.test.ts` | unit | 3 | (supports AC1.1) |
| `src/client/middleware.test.ts` | unit | 3 | AC2.1-AC2.4 |
| `src/client/client.test.ts` | unit | 3 | AC1.1-AC1.4 |
| `src/client/default-client.test.ts` | unit | 3 | AC1.5-AC1.6 |
| `src/providers/openai/openai.test.ts` | unit | 4 | AC3.1, AC3.5, AC3.6, AC4.1-AC4.3, AC4.5, AC8.4, AC9.1-AC9.2 |
| `src/providers/anthropic/anthropic.test.ts` | unit | 4 | AC3.2, AC3.5-AC3.7, AC4.1-AC4.3, AC4.5-AC4.7, AC8.1-AC8.5, AC9.3-AC9.4 |
| `src/providers/gemini/gemini.test.ts` | unit | 4 | AC3.3, AC3.5-AC3.6, AC4.1-AC4.3, AC4.5, AC8.4, AC9.5 |
| `src/providers/openai-compatible/openai-compatible.test.ts` | unit | 4 | AC3.4-AC3.6, AC4.1, AC4.5 |
| `src/catalog/catalog.test.ts` | unit | 4 | (infrastructure) |
| `src/api/generate.test.ts` | unit | 5 | AC5.1-AC5.3, AC5.7-AC5.8, AC7.5, AC10.1-AC10.10 |
| `src/api/stream.test.ts` | unit | 5 | AC5.4-AC5.6, AC7.6 |
| `src/api/multimodal.test.ts` | unit | 5 | AC4.8 |
| `src/api/generate-object.test.ts` | unit | 6 | AC11.1-AC11.5 |
| `src/api/stream-object.test.ts` | unit | 6 | AC11.6-AC11.7 |
| `tests/integration/parity-matrix.test.ts` | integration | 7 | AC12.1 |
| `tests/integration/smoke.test.ts` | e2e | 7 | AC13.1 |
| `tests/integration/caching.test.ts` | integration | 7 | AC8.6 |

---

## Coverage Statistics

| Metric | Count |
|--------|-------|
| Total acceptance criteria | 68 |
| Automated (unit tests) | 62 |
| Automated (integration/e2e tests) | 6 (AC8.6, AC12.1 x13 cells, AC13.1 x6 scenarios) |
| Human verification only | 0 |
| Human verification fallback | 3 (AC8.6, AC12.1, AC13.1) |
| Test files | 23 |
| Infrastructure test files (no direct AC) | 6 |
| AC-verifying test files | 17 |
