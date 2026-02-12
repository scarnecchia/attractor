# Unified LLM SDK Implementation Plan — Phase 3

**Goal:** Build the Client class with provider routing, middleware chain, and environment-based configuration.

**Architecture:** Layer 3 (client/) holds registered adapters, routes requests by provider name, applies middleware in onion order, and manages configuration.

**Tech Stack:** TypeScript 5.7, Vitest 4.0

**Scope:** 7 phases from original design (phases 1-7). This is Phase 3.

**Codebase verified:** 2026-02-10. Phase 1 creates types/, Phase 2 creates utils/. No client/ directory exists yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### unified-llm-sdk.AC1: Client Setup & Configuration
- **unified-llm-sdk.AC1.1 Success:** Client.fromEnv() registers adapters for all providers whose API keys are present
- **unified-llm-sdk.AC1.2 Success:** Client constructed programmatically routes to named provider
- **unified-llm-sdk.AC1.3 Success:** Default provider used when request omits provider field
- **unified-llm-sdk.AC1.4 Failure:** ConfigurationError raised when no provider configured and no default set
- **unified-llm-sdk.AC1.5 Success:** Module-level default client lazy-initializes from env on first use
- **unified-llm-sdk.AC1.6 Success:** setDefaultClient() overrides the lazy-initialized client

### unified-llm-sdk.AC2: Middleware
- **unified-llm-sdk.AC2.1 Success:** Middleware executes in registration order for request phase
- **unified-llm-sdk.AC2.2 Success:** Middleware executes in reverse order for response phase
- **unified-llm-sdk.AC2.3 Success:** Middleware wraps streaming calls (can observe/transform events)
- **unified-llm-sdk.AC2.4 Success:** Multiple middleware compose correctly (onion model)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Environment configuration reader

**Files:**
- Create: `packages/llm/src/client/config.ts`

**Implementation:**

Create `packages/llm/src/client/config.ts` with:

- `ProviderEnvConfig` type mapping environment variable names to provider names:
  ```typescript
  type ProviderEnvConfig = {
    readonly envVar: string;
    readonly providerName: string;
  };
  ```

- `DEFAULT_PROVIDER_ENV_CONFIGS`: Array of known provider env var mappings:
  - `{ envVar: 'OPENAI_API_KEY', providerName: 'openai' }`
  - `{ envVar: 'ANTHROPIC_API_KEY', providerName: 'anthropic' }`
  - `{ envVar: 'GEMINI_API_KEY', providerName: 'gemini' }`
  - `{ envVar: 'GOOGLE_API_KEY', providerName: 'gemini' }` (alternative env var for Gemini)

- `DEFAULT_PROVIDER_OPTION_ENV_CONFIGS`: Additional non-key env vars that configure providers:
  - `{ envVar: 'OPENAI_BASE_URL', providerName: 'openai', option: 'baseUrl' }`
  - `{ envVar: 'OPENAI_ORG_ID', providerName: 'openai', option: 'organization' }`

  These are read by `detectProviders()` and returned alongside the API key so that `Client.fromEnv()` can pass them to adapter constructors.

- `detectProviders()` function: Reads `process.env` and returns a `Record<string, string>` mapping provider names to their API keys for all present env vars. Does NOT create adapter instances — that's the Client's job.

- `ClientConfig` type:
  ```typescript
  type ClientConfig = {
    readonly providers: Record<string, ProviderAdapter>;
    readonly defaultProvider?: string;
    readonly middleware?: ReadonlyArray<Middleware>;
  };
  ```

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add environment configuration reader for provider detection`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Environment configuration tests

**Verifies:** Supports unified-llm-sdk.AC1.1 (tested fully in Task 6)

**Files:**
- Create: `packages/llm/src/client/config.test.ts`

**Testing:**

Use `vi.stubEnv()` to set/unset environment variables in tests.

Tests for `detectProviders`:
- All three env vars set → returns all three provider keys
- Only `OPENAI_API_KEY` set → returns only openai mapping
- No env vars set → returns empty Record
- Empty string env var (`OPENAI_API_KEY=''`) → treated as not present (excluded)
- `GOOGLE_API_KEY` set (no `GEMINI_API_KEY`) → returns gemini mapping with GOOGLE_API_KEY value
- Both `GEMINI_API_KEY` and `GOOGLE_API_KEY` set → `GEMINI_API_KEY` takes precedence
- `OPENAI_BASE_URL` set → returned in provider options for openai
- `OPENAI_ORG_ID` set → returned in provider options for openai

**Verification:**

```bash
cd packages/llm && npm test -- src/client/config.test.ts
```

Expected: All tests pass.

**Commit:** `test: add environment configuration detection tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Middleware chain executor

**Files:**
- Create: `packages/llm/src/client/middleware.ts`

**Implementation:**

Create `packages/llm/src/client/middleware.ts` with:

- `executeMiddlewareChain` function that composes middleware in onion order:

```typescript
function executeMiddlewareChain(
  middlewares: ReadonlyArray<Middleware>,
  request: Request,
  handler: (request: Request) => Promise<Response> | AsyncIterable<StreamEvent>,
): Promise<Response> | AsyncIterable<StreamEvent>;
```

The implementation builds the chain from the inside out: start with the `handler` as the innermost function, then wrap each middleware around it in reverse order (so the first-registered middleware is outermost and executes first for requests, last for responses — the onion model).

For each middleware `mw` at position `i`, create a `next` function that calls either the next middleware or the handler. The middleware calls `next(request)` to proceed inward.

This works for both `complete()` (returns `Promise<Response>`) and `stream()` (returns `AsyncIterable<StreamEvent>`) because the `Middleware` type signature handles both via the union return type.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add middleware chain executor with onion model composition`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Middleware chain tests

**Verifies:** unified-llm-sdk.AC2.1, unified-llm-sdk.AC2.2, unified-llm-sdk.AC2.3, unified-llm-sdk.AC2.4

**Files:**
- Create: `packages/llm/src/client/middleware.test.ts`

**Testing:**

Create mock middleware that records execution order by pushing to a shared array (e.g., `log.push('mw1-before')` before calling `next`, `log.push('mw1-after')` after).

Create a mock handler that returns a canned `Response` for complete mode, or an async generator yielding `StreamEvent` objects for stream mode.

Tests:
- unified-llm-sdk.AC2.1: Two middlewares → request-phase order is [mw1-before, mw2-before, handler]
- unified-llm-sdk.AC2.2: Two middlewares → response-phase order is [handler, mw2-after, mw1-after]
- unified-llm-sdk.AC2.4: Three middlewares compose correctly (full onion: mw1-before, mw2-before, mw3-before, handler, mw3-after, mw2-after, mw1-after)
- unified-llm-sdk.AC2.3: Middleware wrapping streaming: mock handler returns async generator, middleware can observe/transform events by iterating the `AsyncIterable` returned by `next()`
- **Request modification:** Middleware modifies request (e.g., adds a header via providerOptions) before calling next → handler receives modified request
- **No middleware:** Empty middleware array → handler called directly with original request

**Verification:**

```bash
cd packages/llm && npm test -- src/client/middleware.test.ts
```

Expected: All tests pass.

**Commit:** `test: add middleware chain onion model tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Client class

**Files:**
- Create: `packages/llm/src/client/client.ts`

**Implementation:**

Create `packages/llm/src/client/client.ts` with the `Client` class:

```typescript
class Client {
  private readonly providers: Record<string, ProviderAdapter>;
  private readonly defaultProvider: string | null;
  private readonly middlewares: ReadonlyArray<Middleware>;

  constructor(config: ClientConfig);

  static fromEnv(): Client;

  async complete(request: Request): Promise<Response>;
  stream(request: Request): AsyncIterable<StreamEvent>;
  async close(): Promise<void>;
}
```

**Constructor:**
- Store providers, defaultProvider, middleware from config
- If no defaultProvider specified and exactly one provider registered, use it as default

**`fromEnv()`:**
- Call `detectProviders()` from config.ts to get API keys
- For each detected provider, create the corresponding adapter (import adapter constructors from providers/ — but since adapters don't exist yet, `fromEnv()` must accept an optional adapter factory map or we defer full implementation to Phase 4)
- **Strategy for Phase 3:** `fromEnv()` accepts an optional `adapterFactories` parameter: `Record<string, (apiKey: string) => ProviderAdapter>`. In Phase 4, the real adapters will be wired in. For testing in Phase 3, mock adapters are passed.
- Alternatively, `fromEnv()` can be a thin wrapper that reads env vars and delegates adapter creation to a registry. For now, implement it to accept explicit adapter factories.

**`complete(request)`:**
1. Resolve provider: use `request.provider` if specified, fall back to `defaultProvider`
2. If no provider resolved, throw `ConfigurationError`
3. Look up adapter in `this.providers`. If not found, throw `ConfigurationError`
4. Build middleware chain via `executeMiddlewareChain()` with the adapter's `complete` as handler
5. Return the result (which is `Promise<Response>`)

**`stream(request)`:**
1. Same provider resolution as `complete()`
2. Build middleware chain with adapter's `stream` as handler
3. Return the result (which is `AsyncIterable<StreamEvent>`)

**`close()`:**
- Call `close()` on all adapters that implement it (using `Promise.allSettled`)

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add Client class with provider routing and middleware`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Client class tests

**Verifies:** unified-llm-sdk.AC1.1, unified-llm-sdk.AC1.2, unified-llm-sdk.AC1.3, unified-llm-sdk.AC1.4

**Files:**
- Create: `packages/llm/src/client/client.test.ts`

**Testing:**

Create mock adapters implementing `ProviderAdapter`:
```typescript
function createMockAdapter(name: string): ProviderAdapter {
  return {
    name,
    complete: vi.fn().mockResolvedValue(/* mock Response */),
    stream: vi.fn().mockReturnValue(/* mock AsyncIterable */),
  };
}
```

Tests:
- unified-llm-sdk.AC1.2: Client with two providers → `complete({ model: 'gpt-4', provider: 'openai' })` calls the openai adapter
- unified-llm-sdk.AC1.2: Client with two providers → `complete({ model: 'claude-3', provider: 'anthropic' })` calls the anthropic adapter
- unified-llm-sdk.AC1.3: Client with `defaultProvider: 'openai'` → `complete({ model: 'gpt-4' })` (no provider field) calls openai adapter
- unified-llm-sdk.AC1.3: Client with single provider, no explicit default → uses that provider as default
- unified-llm-sdk.AC1.4: Client with no providers → `complete()` throws `ConfigurationError`
- unified-llm-sdk.AC1.4: Client with providers but request specifies unknown provider → throws `ConfigurationError`
- unified-llm-sdk.AC1.1: `Client.fromEnv()` with mock env vars and adapter factories → registers correct adapters (use `vi.stubEnv`)
- unified-llm-sdk.AC1.1: `Client.fromEnv()` with only `ANTHROPIC_API_KEY` set → registers only anthropic adapter
- **stream() routes correctly:** Same routing tests as complete() but for stream()
- **close() calls all adapters:** Two adapters with `close` methods → both called

**Verification:**

```bash
cd packages/llm && npm test -- src/client/client.test.ts
```

Expected: All tests pass.

**Commit:** `test: add Client routing, default provider, and configuration tests`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Default client module

**Files:**
- Create: `packages/llm/src/client/default-client.ts`

**Implementation:**

Create `packages/llm/src/client/default-client.ts` with:

- A module-level `let` variable holding the default client (initially `null`)
- `getDefaultClient(): Client` — returns the current default client. If none set, lazily initializes by calling `Client.fromEnv()`. Caches the result for subsequent calls.
- `setDefaultClient(client: Client): void` — overrides the default client. Subsequent calls to `getDefaultClient()` return this client instead.
- `resetDefaultClient(): void` — clears the cached client (primarily for testing). Next `getDefaultClient()` call will re-initialize from env.

Note: This file path (`src/client/default-client.ts`) matches the Phase 5 api/ layer which imports `getDefaultClient` and `setDefaultClient` from `../client/default-client.js`. Ensure the import path in Phase 5's `generate.ts` and `stream.ts` aligns with this location.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Commit:** `feat: add module-level default client with lazy initialization`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Default client tests

**Verifies:** unified-llm-sdk.AC1.5, unified-llm-sdk.AC1.6

**Files:**
- Create: `packages/llm/src/client/default-client.test.ts`

**Testing:**

Use `vi.stubEnv` and mock adapter factories. Call `resetDefaultClient()` in `beforeEach` to ensure test isolation.

Tests:
- unified-llm-sdk.AC1.5: First call to `getDefaultClient()` with env vars set → creates client from env, returns it
- unified-llm-sdk.AC1.5: Second call to `getDefaultClient()` → returns same cached instance
- unified-llm-sdk.AC1.6: Call `setDefaultClient(customClient)` → `getDefaultClient()` returns customClient
- unified-llm-sdk.AC1.6: `setDefaultClient()` overrides lazy-initialized client: call `getDefaultClient()` first (lazy init), then `setDefaultClient(other)`, then `getDefaultClient()` → returns `other`
- **Reset clears cache:** Call `getDefaultClient()`, then `resetDefaultClient()`, then `getDefaultClient()` → re-initializes from env (new instance)

**Verification:**

```bash
cd packages/llm && npm test -- src/client/default-client.test.ts
```

Expected: All tests pass.

**Commit:** `test: add default client lazy initialization and override tests`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_TASK_9 -->
### Task 9: Client barrel export and full test run

**Files:**
- Create: `packages/llm/src/client/index.ts`
- Modify: `packages/llm/src/index.ts` (add client re-export)
- Modify: `packages/llm/tsup.config.ts` (add client entry point — already listed but verify)

**Step 1: Create client barrel export**

Create `packages/llm/src/client/index.ts` re-exporting from:
- `./client.js`
- `./config.js`
- `./middleware.js`
- `./default-client.js`

**Step 2: Update root barrel export**

Add to `packages/llm/src/index.ts`:
```typescript
export * from './client/index.js';
```

**Step 3: Run full test suite**

```bash
cd packages/llm && npm test
```

Expected: All Phase 2 + Phase 3 tests pass.

**Step 4: Run build**

```bash
cd packages/llm && npm run build
```

Expected: Build succeeds with client/ added to dist/.

**Step 5: Commit**

```bash
git add packages/llm/src/client/index.ts packages/llm/src/index.ts
git commit -m "feat: add client barrel export, verify full test suite"
```
<!-- END_TASK_9 -->
