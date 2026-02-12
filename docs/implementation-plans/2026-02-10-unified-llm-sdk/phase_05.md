# Unified LLM SDK Implementation Plan — Phase 5

**Goal:** Implement the primary generation functions with tool execution loops, retries, and cancellation.

**Architecture:** Layer 4 (api/) provides `generate()`, `stream()` convenience functions wrapping the Client with tool loops, retry, and abort. A lazily-initialized module-level default client serves these functions unless an explicit client is passed.

**Tech Stack:** TypeScript 5.7, Vitest 4.0

**Scope:** 7 phases from original design (phases 1-7). This is Phase 5.

**Codebase verified:** 2026-02-10. Phases 1-4 create types/, utils/, client/, providers/. No api/ directory exists yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### unified-llm-sdk.AC5: Generation
- **unified-llm-sdk.AC5.1 Success:** generate() with simple text prompt returns text response
- **unified-llm-sdk.AC5.2 Success:** generate() with full messages list works
- **unified-llm-sdk.AC5.3 Failure:** generate() with both prompt and messages raises error
- **unified-llm-sdk.AC5.4 Success:** stream() yields TEXT_DELTA events that concatenate to full response
- **unified-llm-sdk.AC5.5 Success:** stream() yields STREAM_START and FINISH with correct metadata
- **unified-llm-sdk.AC5.6 Success:** StreamAccumulator produces response equivalent to complete()
- **unified-llm-sdk.AC5.7 Success:** Abort signal cancels in-flight request, raises AbortError
- **unified-llm-sdk.AC5.8 Success:** Timeouts work (total and per-step)

### unified-llm-sdk.AC10: Tool Calling
- **unified-llm-sdk.AC10.1 Success:** Active tools trigger automatic execution loop
- **unified-llm-sdk.AC10.2 Success:** Passive tools return tool calls without looping
- **unified-llm-sdk.AC10.3 Success:** max_tool_rounds respected
- **unified-llm-sdk.AC10.4 Success:** max_tool_rounds=0 disables automatic execution
- **unified-llm-sdk.AC10.5 Success:** Parallel tool calls executed concurrently via Promise.allSettled
- **unified-llm-sdk.AC10.6 Success:** All parallel results sent in single continuation request
- **unified-llm-sdk.AC10.7 Failure:** Tool execution error sent as is_error result, not exception
- **unified-llm-sdk.AC10.8 Failure:** Unknown tool call sends error result, not exception
- **unified-llm-sdk.AC10.9 Success:** ToolChoice modes (auto, none, required, named) translated per provider
- **unified-llm-sdk.AC10.10 Success:** StepResult tracks each step's calls, results, and usage

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: generate() function — core implementation

**Files:**
- Create: `packages/llm/src/api/generate.ts`

**Implementation:**

Create `packages/llm/src/api/generate.ts` with the `generate()` function:

```typescript
type GenerateOptions = Request & {
  readonly client?: Client;
};

type GenerateResult = {
  readonly response: Response;
  readonly steps: ReadonlyArray<StepResult>;
  readonly totalUsage: Usage;
  readonly text: string;
  readonly toolCalls: ReadonlyArray<ToolCall>;
};

async function generate(options: GenerateOptions): Promise<GenerateResult>;
```

Implementation flow:

1. **Input standardization:**
   - If both `prompt` and `messages` are set → throw `ValidationError` (AC5.3)
   - If `prompt` is set → convert to `[{ role: 'user', content: prompt }]`
   - If `system` is set → prepend as system message (or pass through to adapter — adapters handle system separately)

2. **Client resolution:**
   - Use `options.client` if provided, otherwise `getDefaultClient()`

3. **Resolve images:**
   - Iterate all messages, resolve any file path images via `resolveImageContent()` from utils/image.ts

4. **Tool execution loop:**
   - Call `client.complete(request)` (wrapped in `retry()` from utils/retry.ts, per-step retry AC7.5)
   - Check response for tool calls
   - If response has tool calls AND tools have `execute` functions (active tools, AC10.1):
     - Check `maxToolRounds` (default: 10). If current round >= max → stop looping (AC10.3). If max=0 → never loop (AC10.4).
     - Execute all tool calls concurrently with `Promise.allSettled()` (AC10.5):
       - For each tool call, find the matching tool by name
       - If tool not found → create error result `{ content: 'Unknown tool: ${name}', isError: true }` (AC10.8)
       - If tool found and tool has a `parameters` schema → validate the tool call's `args` against the schema. If validation fails → create error result `{ content: 'Invalid arguments for tool ${name}: ${validationError}', isError: true }` and throw/wrap as `InvalidToolCallError` for logging purposes (the error result is still sent to the model, not thrown to the caller)
       - If tool execution throws → create error result `{ content: error.message, isError: true }` (AC10.7)
       - If tool execution succeeds → create result `{ content: result, isError: false }`
     - Send ALL results in a single continuation request (AC10.6):
       - Append assistant message (with tool calls) and tool result messages to the conversation
       - Call `client.complete()` again
     - Track each step as a `StepResult` (AC10.10)
   - If response has tool calls but tools are passive (no `execute`, AC10.2) → return without looping
   - If no tool calls → return

5. **Build GenerateResult:**
   - `response`: the final response from the last step
   - `steps`: all StepResult objects
   - `totalUsage`: sum of all step usages via `usageAdd()`
   - `text`: concatenate all TextData content parts from the final response
   - `toolCalls`: extract ToolCallData from the final response (for passive tool mode)

6. **Abort signal:** Pass `options.signal` through to every `client.complete()` call.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add generate() with tool execution loop and retry`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: generate() tests

**Verifies:** unified-llm-sdk.AC5.1, unified-llm-sdk.AC5.2, unified-llm-sdk.AC5.3, unified-llm-sdk.AC5.7, unified-llm-sdk.AC5.8, unified-llm-sdk.AC10.1, unified-llm-sdk.AC10.2, unified-llm-sdk.AC10.3, unified-llm-sdk.AC10.4, unified-llm-sdk.AC10.5, unified-llm-sdk.AC10.6, unified-llm-sdk.AC10.7, unified-llm-sdk.AC10.8, unified-llm-sdk.AC10.10

**Files:**
- Create: `packages/llm/src/api/generate.test.ts`

**Testing:**

Create a mock Client with a configurable `complete()` method. Use a helper that returns canned responses and tracks calls.

Tests:
- unified-llm-sdk.AC5.1: `generate({ model: 'test', prompt: 'hello' })` → client.complete called with user message, returns text
- unified-llm-sdk.AC5.2: `generate({ model: 'test', messages: [...] })` → client.complete called with provided messages
- unified-llm-sdk.AC5.3: `generate({ model: 'test', prompt: 'x', messages: [...] })` → throws `ValidationError`
- unified-llm-sdk.AC5.7: Pass an already-aborted signal → throws `AbortError`
- unified-llm-sdk.AC5.8: Mock client.complete that delays → with tight timeout → throws timeout error
- unified-llm-sdk.AC10.1: Response with tool call, active tool that returns "result" → client.complete called twice (original + continuation), final response is text
- unified-llm-sdk.AC10.2: Response with tool call, passive tool (no execute) → returns immediately with toolCalls populated
- unified-llm-sdk.AC10.3: `maxToolRounds: 2`, model keeps requesting tools → stops after 2 rounds
- unified-llm-sdk.AC10.4: `maxToolRounds: 0` → tool calls not executed even with active tools
- unified-llm-sdk.AC10.5: Response with 3 parallel tool calls → all 3 execute concurrently (verify via timing or call order)
- unified-llm-sdk.AC10.6: 3 parallel tool results → single continuation request contains all 3 tool result messages
- unified-llm-sdk.AC10.7: Active tool's execute throws → tool result has `isError: true`, error message as content, loop continues
- unified-llm-sdk.AC10.8: Tool call for unknown tool name → tool result has `isError: true`, "Unknown tool" message
- **Tool arg validation:** Active tool with `parameters` schema, model sends args that don't match schema → tool result has `isError: true`, "Invalid arguments" message (not thrown as exception)
- **Tool arg validation (no schema):** Active tool without `parameters` schema → args not validated, tool execute called directly
- unified-llm-sdk.AC10.10: Multi-step tool loop → `result.steps` has correct count, each step has usage

**Verification:**

```bash
cd packages/llm && npm test -- src/api/generate.test.ts
```

**Commit:** `test: add generate() tests for tool loop, retry, and input validation`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: ToolChoice translation verification

**Verifies:** unified-llm-sdk.AC10.9

**Files:**
- Modify: `packages/llm/src/api/generate.test.ts` (add tests) OR create separate test

**Testing:**

Verify that ToolChoice modes pass through correctly to the client request. This AC is about the translation happening at the adapter level (Phase 4), but generate() should preserve the toolChoice field.

Tests:
- unified-llm-sdk.AC10.9: `toolChoice: { mode: 'auto' }` → request passed to client has `toolChoice.mode === 'auto'`
- unified-llm-sdk.AC10.9: `toolChoice: { mode: 'none' }` → preserved
- unified-llm-sdk.AC10.9: `toolChoice: { mode: 'required' }` → preserved
- unified-llm-sdk.AC10.9: `toolChoice: { mode: 'named', toolName: 'foo' }` → preserved

These are simple pass-through tests. The actual per-provider translation was tested in Phase 4.

**Verification:**

```bash
cd packages/llm && npm test -- src/api/generate.test.ts
```

**Commit:** `test: add ToolChoice pass-through verification`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: stream() function and StreamAccumulator

**Files:**
- Create: `packages/llm/src/api/stream.ts`

**Implementation:**

Create `packages/llm/src/api/stream.ts` with:

**StreamAccumulator class:**
```typescript
class StreamAccumulator {
  private textParts: Array<string> = [];
  private toolCalls: Map<string, { toolName: string; argsParts: Array<string> }> = new Map();
  private usage: Usage | null = null;
  private finishReason: FinishReason | null = null;
  private id: string = '';
  private model: string = '';

  process(event: StreamEvent): void;
  toResponse(): Response;
}
```

`process()` accumulates events:
- `STREAM_START` → capture id, model
- `TEXT_DELTA` → push text
- `TOOL_CALL_START` → init tool call tracking
- `TOOL_CALL_DELTA` → append args
- `TOOL_CALL_END` → finalize tool call
- `THINKING_DELTA` → accumulate thinking text
- `FINISH` → capture finish reason and usage

`toResponse()` → builds a `Response` from accumulated data, equivalent to what `complete()` would return (AC5.6).

**stream() function:**

```typescript
type StreamOptions = Request & {
  readonly client?: Client;
};

type StreamResult = {
  readonly stream: AsyncIterable<StreamEvent>;
  response(): Promise<Response>;
  readonly textStream: AsyncIterable<string>;
};

function stream(options: StreamOptions): StreamResult;
```

Implementation:
- Similar tool loop to generate() but using streaming
- Outer async generator that:
  1. Calls `client.stream(request)` → yields events from the adapter
  2. Accumulates events in a `StreamAccumulator`
  3. At `FINISH`, checks for tool calls
  4. If active tools: execute tools, yield `STEP_FINISH` synthetic event, continue loop
  5. If no tools or passive: yield `FINISH`, done
- `response()`: returns a Promise that resolves when the stream is fully consumed, using the accumulator's `toResponse()`
- `textStream`: filters to only `TEXT_DELTA` events, yields just the text strings

Abort signal and timeout pass through to each `client.stream()` call.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add stream() with StreamAccumulator and tool loop`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: stream() tests

**Verifies:** unified-llm-sdk.AC5.4, unified-llm-sdk.AC5.5, unified-llm-sdk.AC5.6

**Files:**
- Create: `packages/llm/src/api/stream.test.ts`

**Testing:**

Create a mock Client with a configurable `stream()` method that returns an async generator of StreamEvent objects.

Tests:
- unified-llm-sdk.AC5.4: Stream yields TEXT_DELTA events → collecting all text parts and joining produces the full response text
- unified-llm-sdk.AC5.5: Stream yields STREAM_START first (with id, model) and FINISH last (with finishReason, usage)
- unified-llm-sdk.AC5.6: Consume stream via StreamAccumulator → `accumulator.toResponse()` matches what a `complete()` call with the same content would return
- **textStream:** Only yields text strings, not full StreamEvent objects
- **Tool loop in streaming:** Mock stream with tool call events → tools executed → second stream started → yields step_finish between steps
- **Abort during stream:** Abort signal aborted mid-stream → throws AbortError

**Verification:**

```bash
cd packages/llm && npm test -- src/api/stream.test.ts
```

**Commit:** `test: add stream() and StreamAccumulator tests`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Multimodal message test

**Verifies:** unified-llm-sdk.AC4.8

**Files:**
- Create: `packages/llm/src/api/multimodal.test.ts`

**Testing:**

Integration-style test using generate() with a mock Client. Verifies that multimodal messages (text + images mixed in a single user message) pass through correctly to the client.

Tests:
- unified-llm-sdk.AC4.8: User message with text and base64 image content parts → client.complete receives both parts in the correct format
- unified-llm-sdk.AC4.8: User message with text and URL image → passes through correctly

**Verification:**

```bash
cd packages/llm && npm test -- src/api/multimodal.test.ts
```

**Commit:** `test: add multimodal message handling verification`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: API barrel export and full test run

**Files:**
- Create: `packages/llm/src/api/index.ts`
- Modify: `packages/llm/src/index.ts` (add api re-export)

**Step 1: Create api barrel export**

Create `packages/llm/src/api/index.ts` re-exporting from:
- `./generate.js`
- `./stream.js`

**Step 2: Update root barrel export**

Add to `packages/llm/src/index.ts`:
```typescript
export * from './api/index.js';
```

**Step 3: Run full test suite**

```bash
cd packages/llm && npm test
```

Expected: All Phase 2-5 tests pass.

**Step 4: Run build**

```bash
cd packages/llm && npm run build
```

Expected: Build succeeds with api/ added to dist/.

**Step 5: Commit**

```bash
git add packages/llm/src/api/index.ts packages/llm/src/index.ts
git commit -m "feat: add api barrel export, verify full test suite"
```
<!-- END_TASK_7 -->
