# Unified LLM SDK — Human Test Plan

Generated from test coverage analysis against `test-requirements.md`.

## Prerequisites

- Node >= 20.0.0 installed
- API keys set for target providers:
  - `OPENAI_API_KEY` for OpenAI
  - `ANTHROPIC_API_KEY` for Anthropic
  - `GEMINI_API_KEY` or `GOOGLE_API_KEY` for Gemini
- Working directory: `packages/llm`
- `npm install` completed
- `npm test -- --run` passes (349/349 unit tests green)

## Phase 1: Build and Type Safety

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Run `npm run build` | tsup builds successfully, `dist/` created with `.js` and `.d.ts` files |
| 1.2 | Run `npm run typecheck` | Zero TypeScript errors |

## Phase 2: Integration Tests with Real APIs

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Set `ANTHROPIC_API_KEY`. Run `npm run test:integration -- caching.test.ts` | Passes. `cacheWriteTokens > 0` on turn 1, `cacheReadTokens > 0` on turn 2. If flaky, re-run — Anthropic cache TTL is 5 minutes, requires ~1024+ tokens |
| 2.2 | Set all three API keys. Run `npm run test:integration -- parity-matrix.test.ts` | All 39 tests pass (none skipped). Record any failures per-provider. Investigate: SDK bug or provider transient? |
| 2.3 | Set at least one API key. Run `npm run test:integration -- smoke.test.ts` | All 6 scenarios pass. "What is 2+2?" contains "4". Streaming contains digits 1-5. Tool calling returns correct results |

## Phase 3: Cross-Provider Parity Spot Checks

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Script: `generate({ model, prompt: 'Say hello' })` for each of gpt-4o, claude-sonnet-4-20250514, gemini-2.0-flash | All three return non-empty text. Identical response structure (`id`, `model`, `content`, `usage`, `finishReason`). `usage.inputTokens > 0` and `outputTokens > 0` |
| 3.2 | Same with `stream()` for each provider. Consume `.textStream`, print chunks | Each yields coherent text chunks. `STREAM_START` first, `FINISH` last. No errors |
| 3.3 | Define active `get_weather` tool. `generate({ tools, prompt: 'Weather in NYC?' })` per provider | All three invoke tool, receive result, produce final text referencing weather. Step count >= 2 |

## Phase 4: Structured Output Verification

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | `generateObject({ model: 'gpt-4o', schema: PersonSchema, prompt: 'Generate Alice age 30' })` | Returns `{ name: 'Alice', age: 30 }`. `typeof result.object.age === 'number'` |
| 4.2 | Repeat 4.1 with Anthropic model | Valid object. Internally uses `__extract` tool strategy |
| 4.3 | Repeat 4.1 with Gemini model | Valid object. Uses `responseSchema` strategy |
| 4.4 | `streamObject()` with same schema, OpenAI model. Collect partials and final `object()` | Partials grow progressively. Final has all required fields |

## Phase 5: Error Handling Live Verification

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | `generate()` with invalid API key | `AuthenticationError`. `statusCode === 401`. `retryable === false` |
| 5.2 | `generate()` with nonexistent model (e.g., `gpt-nonexistent-99`) | `NotFoundError` or `InvalidRequestError` |
| 5.3 | `generate()` with abort signal, abort after 100ms | `AbortError` within ~100-200ms |

## Phase 6: Provider-Specific Features

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Anthropic with extended thinking (`providerOptions.anthropic.thinking = { type: 'enabled', budget_tokens: 1024 }`) | Response has `THINKING` content part with `text` and non-empty `signature` |
| 6.2 | Multi-turn Anthropic with large system prompt (~2000 tokens). Inspect turn 2 `usage.cacheReadTokens` | `cacheReadTokens > 0` on turn 2 |
| 6.3 | OpenAI with `providerOptions.openai.reasoning_effort = 'high'` on o-series model | Completes. If available, `usage.reasoningTokens > 0` |
| 6.4 | `Client.fromEnv()` with only `ANTHROPIC_API_KEY` set | Client has only Anthropic. `generate()` without provider routes to Anthropic |

## End-to-End: Full Conversation with Tool Loop

1. Define `add(a, b)` and `multiply(a, b)` active tools
2. `generate({ model: 'claude-sonnet-4-20250514', prompt: 'What is 3+4 and also 5*6?', tools })`
3. `result.steps` has >= 2 steps
4. `result.steps[0].toolCalls` has calls to both `add` and `multiply`
5. `result.text` references "7" and "30"
6. `result.totalUsage` has `inputTokens > 0`, `outputTokens > 0`
7. Repeat with OpenAI and Gemini models

## End-to-End: Streaming Tool Loop

1. Same tools as above
2. `stream({ model: 'gpt-4o', prompt: 'What is 10+20 and 3*7?', tools })`
3. Collect all events from `result.stream`
4. Events include: `STREAM_START`, `TOOL_CALL_START`, `TOOL_CALL_END`, `STEP_FINISH`, `TEXT_DELTA`, `FINISH`
5. `result.response()` has text referencing "30" and "21"

## End-to-End: Middleware Pipeline

1. Create logging middleware recording request/response timestamps
2. Create Client with OpenAI adapter + logging middleware
3. `client.complete({ model: 'gpt-4o', messages: [userMessage('Say hello')] })`
4. Middleware log shows request timestamp < response timestamp
5. Response is valid (non-empty text, usage present)

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC8.6 | Cache behaviour depends on provider-side timing, minimum token thresholds (~1024), and 5-minute TTL | Run caching.test.ts with `ANTHROPIC_API_KEY`. If test fails, inspect raw usage for `cache_read_input_tokens`. Retry once for transient failures |
| AC12.1 | Requires all 3 API keys simultaneously. Rate limits or model availability can cause transient failures | Run parity-matrix.test.ts with all keys. Record pass/skip/fail per cell. Investigate failures for SDK vs provider issues |
| AC13.1 | LLM output is non-deterministic. Assertion on "contains 4" may fail if model produces "four" | Run smoke.test.ts. Review actual output for semantic correctness if assertion fails |

## Traceability Matrix

| AC | Automated Test | Manual Step |
|----|----------------|-------------|
| AC1.1 | `client.test.ts` | 6.4 |
| AC1.2 | `client.test.ts` | 3.1 |
| AC1.3 | `client.test.ts` | 6.4 |
| AC1.4 | `client.test.ts` | -- |
| AC1.5-1.6 | `default-client.test.ts` | -- |
| AC2.1-2.4 | `middleware.test.ts` | E2E: Middleware |
| AC3.1-3.7 | Provider test files | 3.1, 3.2 |
| AC4.1-4.3 | Provider test files | 3.1 |
| AC4.4 | `image.test.ts` | -- |
| AC4.5 | Provider test files | 3.3 |
| AC4.6-4.7 | `anthropic.test.ts` | 6.1 |
| AC4.8 | `multimodal.test.ts` | -- |
| AC5.1-5.3 | `generate.test.ts` | 3.1 |
| AC5.4-5.6 | `stream.test.ts` | 3.2 |
| AC5.7 | `generate.test.ts` | 5.3 |
| AC5.8 | `generate.test.ts` | -- |
| AC6.1-6.6 | `error-mapping.test.ts` | 5.1, 5.2 |
| AC7.1-7.6 | `retry.test.ts`, `generate.test.ts`, `stream.test.ts` | -- |
| AC8.1-8.6 | `anthropic.test.ts`, `caching.test.ts` | 2.1, 6.2 |
| AC9.1-9.5 | Provider test files | 6.1, 6.3 |
| AC10.1-10.10 | `generate.test.ts`, provider test files | E2E: Tool Loop, 3.3 |
| AC11.1-11.7 | `generate-object.test.ts`, `stream-object.test.ts` | 4.1-4.4 |
| AC12.1 | `parity-matrix.test.ts` | 2.2 |
| AC13.1 | `smoke.test.ts` | 2.3 |
