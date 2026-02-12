# Unified LLM SDK Implementation Plan — Phase 6

**Goal:** Implement structured output generation with per-provider strategy and incremental parsing.

**Architecture:** `generateObject()` and `streamObject()` wrap generate/stream with schema-based output parsing. OpenAI/Gemini use native JSON schema modes. Anthropic uses tool-based extraction (synthetic tool). `streamObject()` uses `partial-json` for incremental repair.

**Tech Stack:** TypeScript 5.7, Vitest 4.0, partial-json 0.1

**Scope:** 7 phases from original design (phases 1-7). This is Phase 6.

**Codebase verified:** 2026-02-10. Phases 1-5 create types/, utils/, client/, providers/, api/. generateObject/streamObject don't exist yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### unified-llm-sdk.AC11: Structured Output
- **unified-llm-sdk.AC11.1 Success:** generateObject() with OpenAI uses native json_schema
- **unified-llm-sdk.AC11.2 Success:** generateObject() with Gemini uses native responseSchema
- **unified-llm-sdk.AC11.3 Success:** generateObject() with Anthropic uses tool-based extraction
- **unified-llm-sdk.AC11.4 Success:** generateObject() returns parsed, validated output
- **unified-llm-sdk.AC11.5 Failure:** generateObject() raises NoObjectGeneratedError on parse failure
- **unified-llm-sdk.AC11.6 Success:** streamObject() yields progressively larger partial objects
- **unified-llm-sdk.AC11.7 Success:** streamObject() final object validates against schema

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: generateObject() implementation

**Files:**
- Create: `packages/llm/src/api/generate-object.ts`

**Implementation:**

```typescript
type GenerateObjectOptions = Request & {
  readonly client?: Client;
  readonly schema: Record<string, unknown>;
  readonly schemaName?: string;
};

type GenerateObjectResult<T> = {
  readonly object: T;
  readonly response: Response;
  readonly usage: Usage;
};

async function generateObject<T>(options: GenerateObjectOptions): Promise<GenerateObjectResult<T>>;
```

Implementation flow:

1. **Resolve client and provider:** Same as generate().

2. **Determine strategy based on provider:**
   - **OpenAI / OpenAI-compatible:** Use native `json_schema` response format (AC11.1)
     - Set `responseFormat` on the request using `wrapSchemaForOpenAI()` from utils/json-schema.ts
     - Call `generate()` normally
     - Parse response text as JSON
   - **Gemini:** Use native `responseSchema` (AC11.2)
     - Set `providerOptions.gemini.generationConfig.responseSchema` = schema
     - Set `providerOptions.gemini.generationConfig.responseMimeType` = `'application/json'`
     - Call `generate()` normally
     - Parse response text as JSON
   - **Anthropic:** Use tool-based extraction (AC11.3)
     - Create synthetic tool via `createExtractionTool()` from utils/json-schema.ts
     - Add to `tools` array
     - Set `toolChoice: { mode: 'named', toolName: '__extract' }`
     - Call `generate()` — model will be forced to call `__extract` tool
     - Parse the tool call arguments as the structured output

3. **Validate output:**
   - `JSON.parse()` the text/arguments → if parse fails, throw `NoObjectGeneratedError` (AC11.5)
   - Basic structural validation against schema (check required fields exist) → if fails, throw `NoObjectGeneratedError` (AC11.5)
   - Return parsed object (AC11.4)

4. **Build result:**
   - `object`: the parsed, validated output
   - `response`: the underlying Response
   - `usage`: from the generate result

Detect provider by checking `options.provider` or the default client's default provider. Access the adapter name through the client.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add generateObject() with per-provider structured output strategy`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: generateObject() tests

**Verifies:** unified-llm-sdk.AC11.1, unified-llm-sdk.AC11.2, unified-llm-sdk.AC11.3, unified-llm-sdk.AC11.4, unified-llm-sdk.AC11.5

**Files:**
- Create: `packages/llm/src/api/generate-object.test.ts`

**Testing:**

Create mock clients with mock adapters that return canned responses for each provider strategy.

Tests:
- unified-llm-sdk.AC11.1: OpenAI provider → request has `responseFormat` with json_schema → response text parsed as JSON → returns object
- unified-llm-sdk.AC11.2: Gemini provider → request has `generationConfig.responseSchema` → response text parsed as JSON → returns object
- unified-llm-sdk.AC11.3: Anthropic provider → request has `__extract` tool with `toolChoice.mode === 'named'` → tool call arguments parsed as output
- unified-llm-sdk.AC11.4: Valid JSON output with all schema fields → returns parsed object with correct types
- unified-llm-sdk.AC11.5: Response with invalid JSON → throws `NoObjectGeneratedError` with raw response
- unified-llm-sdk.AC11.5: Response with valid JSON but missing required field → throws `NoObjectGeneratedError`
- **Schema passed through:** Verify the schema appears in the correct location per provider

**Verification:**

```bash
cd packages/llm && npm test -- src/api/generate-object.test.ts
```

**Commit:** `test: add generateObject() tests for all provider strategies`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: streamObject() implementation

**Files:**
- Create: `packages/llm/src/api/stream-object.ts`

**Implementation:**

```typescript
type StreamObjectOptions = Request & {
  readonly client?: Client;
  readonly schema: Record<string, unknown>;
  readonly schemaName?: string;
};

type StreamObjectResult<T> = {
  readonly stream: AsyncIterable<Partial<T>>;
  object(): Promise<T>;
};

function streamObject<T>(options: StreamObjectOptions): StreamObjectResult<T>;
```

Implementation flow:

1. **Same provider strategy as generateObject()** but using stream() instead of generate().

2. **Accumulate and repair:**
   - For OpenAI/Gemini (text-based): accumulate `TEXT_DELTA` events into a growing JSON string
   - For Anthropic (tool-based): accumulate `TOOL_CALL_DELTA` events into a growing JSON string
   - After each delta, attempt `parse()` from `partial-json` with `STR | OBJ | ARR | NUM | NULL` flags
   - If `partial-json` returns a new valid partial object (different from previous), yield it
   - Track the last yielded partial to avoid duplicate yields

3. **Final validation:**
   - After stream completes, run full `JSON.parse()` on the complete accumulated string
   - Validate against schema
   - If validation fails → throw `NoObjectGeneratedError`

4. **`object()` method:** Returns a Promise that resolves when the stream is fully consumed and the final validated object is available.

Import `parse` from `partial-json`.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add streamObject() with incremental partial-json repair`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: streamObject() tests

**Verifies:** unified-llm-sdk.AC11.6, unified-llm-sdk.AC11.7

**Files:**
- Create: `packages/llm/src/api/stream-object.test.ts`

**Testing:**

Create a mock client whose `stream()` returns an async generator that yields TEXT_DELTA events with partial JSON chunks. For example, for the schema `{ name: string, age: number }`:
- Delta 1: `{"na`
- Delta 2: `me": "Ali`
- Delta 3: `ce", "ag`
- Delta 4: `e": 30}`

Tests:
- unified-llm-sdk.AC11.6: Stream yields progressively larger partial objects: first partial might be `{ name: "Ali" }`, then `{ name: "Alice" }`, then `{ name: "Alice", age: 30 }`. Each yielded partial is a valid (incomplete) object.
- unified-llm-sdk.AC11.6: Partials are de-duplicated: if partial-json returns the same object after a delta, it's not yielded again
- unified-llm-sdk.AC11.7: Final `object()` call returns the fully validated object matching the schema
- unified-llm-sdk.AC11.7: If final JSON is malformed → `object()` throws `NoObjectGeneratedError`
- **Anthropic strategy:** Stream with TOOL_CALL_DELTA events (instead of TEXT_DELTA) → same partial object behavior

**Verification:**

```bash
cd packages/llm && npm test -- src/api/stream-object.test.ts
```

**Commit:** `test: add streamObject() partial parsing and validation tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update api barrel export and full test run

**Files:**
- Modify: `packages/llm/src/api/index.ts` (add structured output exports)

**Step 1: Update api barrel**

Add to `packages/llm/src/api/index.ts`:
```typescript
export * from './generate-object.js';
export * from './stream-object.js';
```

**Step 2: Run full test suite**

```bash
cd packages/llm && npm test
```

Expected: All Phase 2-6 tests pass.

**Step 3: Run build**

```bash
cd packages/llm && npm run build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/llm/src/api/index.ts
git commit -m "feat: add structured output exports, verify full test suite"
```
<!-- END_TASK_5 -->
