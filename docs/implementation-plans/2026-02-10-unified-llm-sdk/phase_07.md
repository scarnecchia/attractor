# Unified LLM SDK Implementation Plan — Phase 7

**Goal:** Validate the full stack against real provider APIs using the spec's parity matrix and smoke test.

**Architecture:** Integration tests live in `packages/llm/tests/integration/` and run against real APIs with valid keys. Tests are conditional — skip individual providers when their API key is not set.

**Tech Stack:** TypeScript 5.7, Vitest 4.0, real provider API keys

**Scope:** 7 phases from original design (phases 1-7). This is Phase 7 (final).

**Codebase verified:** 2026-02-10. Phases 1-6 implement the full SDK stack. No tests/integration/ directory exists yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### unified-llm-sdk.AC12: Cross-Provider Parity
- **unified-llm-sdk.AC12.1 Success:** Spec Section 8.9 parity matrix — all cells pass for all 3 providers

### unified-llm-sdk.AC13: Integration Smoke Test
- **unified-llm-sdk.AC13.1 Success:** Spec Section 8.10 end-to-end test passes against real APIs

---

<!-- START_TASK_1 -->
### Task 1: Integration test infrastructure

**Files:**
- Create: `packages/llm/tests/integration/helpers.ts`
- Modify: `packages/llm/vitest.config.ts` (add integration test config)

**Implementation:**

**helpers.ts:**

Create shared helpers for integration tests:

```typescript
function skipIfNoKey(provider: string): void;
```

Checks for the appropriate env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`). If not set, calls `test.skip()` to skip the test gracefully.

```typescript
function createTestClient(): Client;
```

Creates a Client via `Client.fromEnv()` with real adapter factories.

```typescript
const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
type TestProvider = typeof PROVIDERS[number];
```

Helper to run a test across all providers:
```typescript
function describeForEachProvider(
  name: string,
  fn: (provider: TestProvider) => void,
): void;
```

Uses `describe.each(PROVIDERS)` pattern. Each inner test calls `skipIfNoKey()`.

Define common test fixtures:
- A simple text prompt
- A tool definition (e.g., `get_weather`)
- A schema for structured output
- A base64-encoded test image (tiny 1x1 PNG)

**vitest.config.ts update:**

Add a separate test config or extend the existing one with an `integration` project:
```typescript
test: {
  include: ['src/**/*.test.ts'],
  // Integration tests run separately
},
```

Add a script in package.json: `"test:integration": "vitest run --dir tests/integration"` with a longer timeout (30s per test).

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add integration test infrastructure with provider skip logic`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Cross-provider parity matrix

**Verifies:** unified-llm-sdk.AC12.1

**Files:**
- Create: `packages/llm/tests/integration/parity-matrix.test.ts`

**Testing:**

Implement the parity matrix from spec Section 8.9. Each test case runs against all 3 providers (OpenAI, Anthropic, Gemini) using the `describeForEachProvider` helper.

Test cases for each provider:

1. **Simple generation:** `generate({ model, prompt: 'Say hello' })` → response has non-empty text
2. **Streaming:** `stream({ model, prompt: 'Count to 3' })` → yields STREAM_START, at least one TEXT_DELTA, and FINISH
3. **Image input (base64):** `generate({ model, messages: [{ role: 'user', content: [textPart, imagePart] }] })` → response has text (describe the image)
4. **Image input (URL):** `generate({ model, messages: [{ role: 'user', content: [textPart, urlImagePart] }] })` → response has text describing the image (tests URL-based image path separately from base64)
5. **Single tool call:** Define `get_weather` active tool → model calls it → loop completes → final response references weather
6. **Parallel tool calls:** Define two tools, prompt that requires both → both called via `Promise.allSettled` → results sent in single continuation
7. **Multi-step tool loop:** Define tool that requires 2+ rounds → loop executes multiple steps → final response complete
8. **Streaming with tools:** Same tool test but via `stream()` → yields tool-related events and step_finish
9. **Structured output:** `generateObject({ model, schema: { type: 'object', properties: { name: { type: 'string' } } } })` → returns valid object matching schema
10. **Error handling (invalid key):** Use invalid API key → throws `AuthenticationError` (401)
11. **Usage accuracy:** `generate()` → `result.totalUsage.inputTokens > 0` and `outputTokens > 0`
12. **Provider options passthrough:** Pass provider-specific option → no error (option reaches provider)
13. **Rate limit error handling:** Use a request crafted to trigger rate limiting (or mock the error path if not feasible live) → throws `RateLimitError` with appropriate `retryAfter` hint when available

Provider-specific additional tests:
- **OpenAI:** Reasoning tokens present for o-series models (if testing with o1/o3)
- **Anthropic:** Thinking blocks present when extended thinking enabled
- **Anthropic caching:** Covered in separate test file (Task 4)
- **Gemini:** `thoughtsTokenCount` mapped when using thinking-capable model

All integration tests should use low `maxTokens` (50-100) to minimize API costs.

Use `test.concurrent` where possible for faster execution.

**Verification:**

```bash
cd packages/llm && npm run test:integration -- parity-matrix.test.ts
```

Expected: All cells pass for providers with valid API keys. Providers without keys are skipped.

**Commit:** `test: add cross-provider parity matrix integration tests`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: End-to-end smoke test

**Verifies:** unified-llm-sdk.AC13.1

**Files:**
- Create: `packages/llm/tests/integration/smoke.test.ts`

**Testing:**

Implement the smoke test from spec Section 8.10. This is a sequential scenario that exercises the full stack:

1. **Basic generation (all providers):** For each provider, `generate({ prompt: 'What is 2+2?' })` → response contains "4"
2. **Streaming verification:** `stream({ prompt: 'Count from 1 to 5' })` → collect all TEXT_DELTA, verify they concatenate to something containing "1", "2", "3", "4", "5"
3. **Image input:** `generate({ model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this image' }, { type: 'image', data: base64Png, mimeType: 'image/png' }] }] })` → response has non-empty text describing the image
4. **Tool calling with parallel execution:** Define `add(a, b)` and `multiply(a, b)` tools. Prompt: "What is 3+4 and 2*5?" → both tools called → results sent back → final response has "7" and "10"
5. **Structured output:** `generateObject({ schema: PersonSchema, prompt: 'Generate a person named Alice who is 30' })` → `result.object.name === 'Alice'` and `result.object.age === 30`
6. **Error handling:** Invalid API key → `AuthenticationError` thrown (verify instanceof)

Run against one provider (the first one with a valid key) for the smoke test. The parity matrix covers cross-provider.

**Verification:**

```bash
cd packages/llm && npm run test:integration -- smoke.test.ts
```

Expected: All 6 scenarios pass.

**Commit:** `test: add end-to-end smoke test`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Anthropic caching verification

**Verifies:** unified-llm-sdk.AC8.6

**Files:**
- Create: `packages/llm/tests/integration/caching.test.ts`

**Testing:**

Tests verifying that prompt caching works across providers:

**Anthropic caching (requires `ANTHROPIC_API_KEY`):**

- **unified-llm-sdk.AC8.6:** Multi-turn session shows >50% cache hits on turn 2+
  1. Send a large system prompt (~2000 tokens of text) + short user message → record usage (turn 1)
  2. Send the same system prompt + different short user message → record usage (turn 2)
  3. Assert: `turn2.usage.cacheReadTokens > 0`
  4. Assert: `turn2.usage.cacheReadTokens` represents a significant portion of the system prompt tokens

- **Cache write on first turn:** Turn 1 should show `cacheWriteTokens > 0` (Anthropic writes the cache)

**OpenAI caching (requires `OPENAI_API_KEY`):**

- Send two identical requests with the same prompt content → on the second request, check if `usage.cacheReadTokens > 0` (mapped from `prompt_tokens_details.cached_tokens`). Note: OpenAI's caching is automatic and may not trigger in all cases; this test should be conditional and not fail if caching doesn't activate (mark as `test.skip` with a note if cacheReadTokens is 0).

**Gemini caching (requires `GEMINI_API_KEY`):**

- Send a request and verify that `usage.cacheReadTokens` is populated from `usageMetadata.cachedContentTokenCount` when present. Note: Gemini's cached content requires explicit cache creation via their Caching API, which is outside the scope of this SDK. This test verifies the mapping works when the field is present in the response, not that caching is triggered. Use a simple generation and verify the field maps correctly (may be 0 if no cached content context is used).

Skip individual provider sections when their API key is not set.

Use a deterministic large system prompt (e.g., the first 2000 tokens of lorem ipsum or a repeated technical paragraph) for the Anthropic test.

**Verification:**

```bash
cd packages/llm && npm run test:integration -- caching.test.ts
```

Expected: Cache read tokens > 0 on turn 2.

**Commit:** `test: add Anthropic prompt caching multi-turn verification`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Final build verification and cleanup

**Step 1: Run full unit test suite**

```bash
cd packages/llm && npm test
```

Expected: All unit tests from Phases 2-6 pass.

**Step 2: Run integration tests (if API keys available)**

```bash
cd packages/llm && npm run test:integration
```

Expected: All integration tests pass (or skip for missing keys).

**Step 3: Run full build**

```bash
cd packages/llm && npm run build
```

Expected: Clean build with all subpath exports in dist/.

**Step 4: Verify subpath exports work**

```bash
cd packages/llm && node -e "import('@attractor/llm').then(m => console.log(Object.keys(m)))"
```

Expected: Lists all exported names.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete unified LLM SDK implementation (phases 1-7)"
```
<!-- END_TASK_5 -->
