# Coding Agent Loop Implementation Plan — Phase 8

**Goal:** Complete error handling (tool errors, provider errors, graceful shutdown), implement context window awareness, run integration smoke tests against Anthropic, and validate cross-provider parity.

**Architecture:** Error handling is integrated into the agentic loop (`processInput`) and the Session lifecycle. The loop catches specific SDK error types (`AuthenticationError`, `ContextLengthError`) and transitions session state accordingly. Context window tracking uses a character-based heuristic (1 token ≈ 4 chars) on accumulated history. Integration tests use real Anthropic API calls; parity tests use mock LLM responses for all three profiles.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only, @attractor/llm (error hierarchy, Client)

**Scope:** 8 phases from original design (phase 8 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC11: Error Handling
- **coding-agent-loop.AC11.1 Success:** Tool execution errors → error result to LLM (model can recover)
- **coding-agent-loop.AC11.2 Success:** AuthenticationError → surface immediately, session → CLOSED
- **coding-agent-loop.AC11.3 Success:** ContextLengthError → emit warning, session → CLOSED
- **coding-agent-loop.AC11.4 Success:** Context window warning emitted at ~80% usage (1 token ≈ 4 chars heuristic)
- **coding-agent-loop.AC11.5 Success:** Graceful shutdown: cancel stream → kill processes → flush events → SESSION_END → close subagents → CLOSED

### coding-agent-loop.AC12: Integration & Parity
- **coding-agent-loop.AC12.1 Success:** Anthropic integration smoke test: file creation, read-then-edit, shell execution with real API key
- **coding-agent-loop.AC12.2 Success:** Truncation verified end-to-end: TOOL_CALL_END has full output, LLM gets truncated version
- **coding-agent-loop.AC12.3 Success:** Cross-provider parity: all three profiles produce correct tool definitions and can run the loop (unit-tested with mocked LLM)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Error handling in the agentic loop

**Verifies:** coding-agent-loop.AC11.1, coding-agent-loop.AC11.2, coding-agent-loop.AC11.3

**Files:**
- Modify: `packages/agent/src/session/loop.ts`
- Test: `packages/agent/src/session/error-handling.test.ts` (unit)

**Implementation:**

Add error handling to `processInput()` in `loop.ts`. The loop already exists from Phase 4 — this task adds specific error catch branches.

**Error classification within the loop:**

```typescript
import {
  AuthenticationError,
  ContextLengthError,
  ProviderError,
  AbortError,
} from '@attractor/llm';

// Inside processInput(), wrap the stream/tool-execution cycle:
try {
  // ... existing stream + tool execution loop ...
} catch (error: unknown) {
  if (error instanceof AbortError) {
    // Already handled by abort signal path (AC1.7 from Phase 4)
    return;
  }

  if (error instanceof AuthenticationError) {
    // AC11.2: Surface immediately, session → CLOSED
    emitter.emit({ kind: 'ERROR', error: error as Error });
    transitionTo('CLOSED');
    return;
  }

  if (error instanceof ContextLengthError) {
    // AC11.3: Emit warning, session → CLOSED
    emitter.emit({ kind: 'CONTEXT_WARNING', usagePercent: 100 });
    emitter.emit({ kind: 'ERROR', error: error as Error });
    transitionTo('CLOSED');
    return;
  }

  if (error instanceof ProviderError && error.retryable) {
    // Retryable errors (429, 500-503) are handled by @attractor/llm's
    // retry layer in stream()/generate(). If they still surface here,
    // the retry budget was exhausted — treat as fatal.
    emitter.emit({ kind: 'ERROR', error: error as Error });
    transitionTo('CLOSED');
    return;
  }

  // Unknown/unexpected errors → surface and close
  emitter.emit({
    kind: 'ERROR',
    error: error instanceof Error ? error : new Error(String(error)),
  });
  transitionTo('CLOSED');
}
```

**Tool execution errors** (AC11.1) are already handled by the tool dispatch logic from Phase 3 — `dispatchToolCalls` catches executor exceptions and returns them as `ToolResult` with `isError: true`. The model receives the error message and can recover. No additional code needed for AC11.1 beyond verifying with tests.

**Testing:**

Tests use a mock Client that throws specific error types:

- coding-agent-loop.AC11.1: Mock a tool executor that throws → verify the loop continues with an error result sent to the LLM (not a session crash). The LLM receives a `ToolResult` with `isError: true`.
- coding-agent-loop.AC11.2: Mock Client.stream() that throws `AuthenticationError` → verify `ERROR` event emitted with the auth error, session state becomes `CLOSED`.
- coding-agent-loop.AC11.3: Mock Client.stream() that throws `ContextLengthError` → verify both `CONTEXT_WARNING` (100%) and `ERROR` events emitted, session state becomes `CLOSED`.
- Verify that retryable `ProviderError` (e.g., `RateLimitError`) that surfaces past retry layer → session closes with `ERROR` event.
- Verify unknown error (e.g., `TypeError`) → session closes with `ERROR` event.

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All error handling tests pass.

**Commit:** `feat(agent): implement error handling in agentic loop`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Context window awareness

**Verifies:** coding-agent-loop.AC11.4

**Files:**
- Create: `packages/agent/src/session/context-tracking.ts`
- Test: `packages/agent/src/session/context-tracking.test.ts` (unit)

**Implementation:**

`packages/agent/src/session/context-tracking.ts`:

Tracks approximate token usage across the session's conversation history using a character-based heuristic.

```typescript
export type ContextTracker = {
  readonly record: (chars: number) => void;
  readonly check: () => number | null;
  readonly totalChars: () => number;
  readonly reset: () => void;
};

export function createContextTracker(
  contextWindowSize: number | undefined,
  warningThreshold?: number,
): ContextTracker {
  // If contextWindowSize is undefined, tracking is disabled (check() always returns null)
  //
  // warningThreshold: defaults to 0.8 (80%)
  //
  // Heuristic: 1 token ≈ 4 characters
  //   contextWindowChars = contextWindowSize * 4
  //
  // record(chars): Add chars to running total
  //   Called after each Turn is appended to history:
  //   - UserTurn: content.length
  //   - AssistantTurn: sum of content parts (text.length + JSON.stringify(toolCall).length + ...)
  //   - ToolResultsTurn: sum of output.length for each result
  //   - SystemTurn/SteeringTurn: content.length
  //
  // check(): Returns usagePercent if >= warningThreshold, null otherwise
  //   usagePercent = totalChars / contextWindowChars
  //   Returns null if tracking disabled or below threshold
  //
  // totalChars(): Current total
  //
  // reset(): Reset to 0 (for testing)
}
```

**Integration with the loop:**

After each turn is appended to history in `processInput()`, call `contextTracker.record(turnChars)`. Then call `contextTracker.check()` — if it returns a non-null usagePercent, emit `CONTEXT_WARNING` event:

```typescript
const usagePercent = contextTracker.check();
if (usagePercent !== null) {
  emitter.emit({ kind: 'CONTEXT_WARNING', usagePercent });
}
```

**Testing:**

- coding-agent-loop.AC11.4: Create tracker with contextWindowSize=1000 (4000 chars). Record chars until ~80% threshold. Verify `check()` returns usagePercent >= 0.8. Record more chars → returns higher usagePercent.
- Below threshold → `check()` returns null
- No contextWindowSize → `check()` always returns null
- Verify at 80% exactly (3200 chars of 4000 char budget)
- Verify at 100% (4000 chars)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All context tracking tests pass.

**Commit:** `feat(agent): implement context window awareness`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Graceful shutdown

**Verifies:** coding-agent-loop.AC11.5

**Files:**
- Modify: `packages/agent/src/session/session.ts`
- Test: `packages/agent/src/session/shutdown.test.ts` (unit)

**Implementation:**

The `abort()` method on Session must implement a graceful shutdown sequence:

```typescript
// In session.ts, the abort() implementation:
async function abort(): Promise<void> {
  // 1. Cancel active LLM stream via AbortController.abort()
  // 2. Kill running processes:
  //    - For each active tool execution, signal termination via AbortController
  //    - LocalExecutionEnvironment's execCommand already handles SIGTERM → 2s → SIGKILL
  // 3. Flush pending events from the emitter buffer
  // 4. Close all subagents via subAgentMap.closeAll()
  // 5. Emit SESSION_END event
  // 6. Complete the event emitter (emitter.complete())
  // 7. Transition state to CLOSED
}
```

**Testing:**

Tests must verify the full shutdown sequence:
- coding-agent-loop.AC11.5: Start a session with a mock Client streaming. During streaming, call `abort()`. Verify:
  - Stream is cancelled (AbortController.abort called)
  - `SESSION_END` event is emitted
  - Event iterator completes (for-await loop exits)
  - Session state transitions to `CLOSED`
  - All subagents closed (if any spawned)
  - Events emitted in correct order: any pending events → `SESSION_END`
- Verify abort during tool execution: mock a slow tool executor, abort mid-execution, verify clean shutdown
- Verify abort is idempotent (calling abort twice doesn't crash)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All shutdown tests pass.

**Commit:** `feat(agent): implement graceful shutdown`

<!-- END_TASK_3 -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Integration smoke test — Anthropic

**Verifies:** coding-agent-loop.AC12.1, coding-agent-loop.AC12.2

**Files:**
- Create: `packages/agent/tests/integration/helpers.ts`
- Create: `packages/agent/tests/integration/smoke.test.ts`

**Implementation:**

`packages/agent/tests/integration/helpers.ts`:

```typescript
export function hasAnthropicKey(): boolean {
  return !!process.env['ANTHROPIC_API_KEY'];
}

export const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
```

`packages/agent/tests/integration/smoke.test.ts`:

Integration tests that run a full agentic loop against Anthropic's API. Each test creates a real Session with an Anthropic profile, a real Client, and a real LocalExecutionEnvironment pointing to a temp directory.

```typescript
import { describe, test, beforeEach, afterEach } from 'vitest';
import { Client } from '@attractor/llm';
import { createAnthropicProfile } from '../../src/profiles/anthropic/index.js';
import { createSession } from '../../src/session/session.js';
// ... other imports

describe('Anthropic Integration Smoke Test', () => {
  // Setup: Create temp directory for each test, cleanup after
  // Skip all tests if ANTHROPIC_API_KEY not set

  // Scenario 1: File creation
  // Submit: "Create a file called hello.txt with 'Hello, World!'"
  // Verify: hello.txt exists with correct content
  // Verify: events include TOOL_CALL_START/END for write_file

  // Scenario 2: Read-then-edit
  // Pre-create a file, submit: "Read the file and change X to Y"
  // Verify: file contains edited content
  // Verify: events include read_file and edit_file tool calls

  // Scenario 3: Shell execution
  // Submit: "Run 'echo hello' in the shell"
  // Verify: events include shell tool call with 'hello' in output

  // Scenario 4: Truncation verification (AC12.2)
  // Pre-create a large file (> 50k chars)
  // Submit: "Read the file large.txt"
  // Verify: TOOL_CALL_END event has full untruncated output
  // Verify: The LLM received a truncated version (check via history
  //   inspection — the ToolResultsTurn should have truncated output)

  // Scenario 5: Steering / follow-up (AC6.1, AC6.2)
  // Submit: "Create a file called test.txt with 'initial'"
  // Wait for SESSION_IDLE event
  // Submit follow-up: "Now change 'initial' to 'updated' in test.txt"
  // Wait for SESSION_END or SESSION_IDLE
  // Verify: test.txt contains 'updated'
  // Verify: Session history has two user turns (steering preserved context)

  // Scenario 6: Subagent (AC7.1, AC7.6) — only if maxSubagentDepth > 0
  // Submit: "Spawn a subagent to create a file called sub.txt with 'from subagent'"
  // Wait for completion
  // Verify: sub.txt exists with 'from subagent'
  // Verify: events include SUBAGENT_EVENT wrappers
  // Note: This scenario is more fragile (depends on LLM choosing to use
  //   spawn_agent). If it proves unreliable, degrade to a parity matrix test
  //   that mocks the LLM response to call spawn_agent deterministically.
});
```

**Important:** These tests use real API calls and are expensive. They should be:
- Skipped if `ANTHROPIC_API_KEY` is not set
- Run separately via `npm run test:integration`
- Have a 60s timeout per test

**Testing:**

- coding-agent-loop.AC12.1: Scenarios 1-3 verify file creation, read-then-edit, and shell execution work end-to-end with a real API key.
- coding-agent-loop.AC12.2: Scenario 4 verifies truncation — TOOL_CALL_END event carries full output while the LLM gets truncated.
- coding-agent-loop.AC6.1, AC6.2: Scenario 5 verifies steering/follow-up — second submit() preserves history context from first interaction.
- coding-agent-loop.AC7.1, AC7.6: Scenario 6 verifies subagent spawning and result propagation end-to-end (fragile — may need mock fallback).

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run test:integration`
Expected: All smoke tests pass (or skip gracefully if no API key).

**Commit:** `test(agent): add Anthropic integration smoke tests`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Cross-provider parity matrix

**Verifies:** coding-agent-loop.AC12.3

**Files:**
- Create: `packages/agent/tests/integration/parity-matrix.test.ts`

**Implementation:**

The parity matrix verifies that all three profiles produce correct tool definitions and can run the agentic loop. Uses mock LLM responses (not real API calls) for deterministic, fast testing.

```typescript
import { describe, test } from 'vitest';
import { createOpenAIProfile } from '../../src/profiles/openai/index.js';
import { createAnthropicProfile } from '../../src/profiles/anthropic/index.js';
import { createGeminiProfile } from '../../src/profiles/gemini/index.js';

const PROFILES = [
  { name: 'openai', create: createOpenAIProfile },
  { name: 'anthropic', create: createAnthropicProfile },
  { name: 'gemini', create: createGeminiProfile },
] as const;

describe('Cross-Provider Parity Matrix', () => {
  describe.each(PROFILES)('$name profile', ({ create }) => {

    // 1. Tool definitions
    // Verify profile produces correct tool definitions:
    // - All profiles have: read_file, write_file, shell, grep, glob
    // - OpenAI has: apply_patch (NOT edit_file)
    // - Anthropic has: edit_file (NOT apply_patch)
    // - Gemini has: edit_file, list_dir (NOT apply_patch)

    // 2. System prompt
    // Verify buildSystemPrompt() returns non-empty string containing
    // identity, tool guidance, coding best practices

    // 3. Capability flags
    // Verify supportsParallelToolCalls is set correctly

    // 4. Agentic loop simulation
    // Create a Session with a mock Client that returns:
    //   Round 1: assistant response with a read_file tool call
    //   Round 2: assistant response with text only (natural completion)
    // Verify the loop:
    //   - Executes the read_file tool call
    //   - Receives the tool result
    //   - Calls the LLM again
    //   - Exits on natural completion
    //   - Emits correct events (SESSION_START, TOOL_CALL_START, TOOL_CALL_END, SESSION_END)

    // 5. Tool dispatch
    // For each tool in the profile, verify the executor is callable
    // with a mock ExecutionEnvironment
  });
});
```

**Mock Client pattern** (reuse from Phase 4):
```typescript
function createMockClient(responses: Array<Array<StreamEvent>>): Client {
  // Returns a Client-like object where each call to stream()
  // yields the next response from the array as an async iterable
}
```

**Testing:**

- coding-agent-loop.AC12.3: All three profiles produce correct tool definitions. All three can run the loop (stream → tool execution → natural completion) with mock LLM responses.
- Profile-specific assertions:
  - OpenAI: has `apply_patch`, no `edit_file`
  - Anthropic: has `edit_file`, no `apply_patch`
  - Gemini: has `edit_file`, `list_dir`, no `apply_patch`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All parity matrix tests pass.

**Commit:** `test(agent): add cross-provider parity matrix`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update barrel exports and vitest config for integration tests

**Files:**
- Modify: `packages/agent/src/session/index.ts` (add context-tracking export)
- Modify: `packages/agent/vitest.config.ts` (add integration test config)

**Implementation:**

Update `packages/agent/src/session/index.ts` to export the new context-tracking module:

```typescript
// Add to existing exports:
export * from './context-tracking.js';
```

Update `packages/agent/vitest.config.ts` to support separate integration test runs. Follow the same pattern as `@attractor/llm`:

The vitest config should already include `src/**/*.test.ts` for unit tests. Add a separate configuration for integration tests:

```typescript
// In package.json scripts:
// "test": "vitest run",
// "test:integration": "vitest run --config vitest.integration.config.ts"
```

Create `packages/agent/vitest.integration.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All unit tests pass (previous phases + error handling + context tracking + shutdown + parity matrix).

**Commit:** `chore(agent): update barrel exports and integration test config`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Final verification — full build, typecheck, all tests

**Files:** None (verification only)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes with zero errors.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All unit tests pass across all 8 phases.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run test:integration`
Expected: Integration tests pass if ANTHROPIC_API_KEY is set, skip gracefully if not.

**Commit:** Not needed unless fixes are required.

<!-- END_TASK_7 -->
