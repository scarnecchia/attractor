# Coding Agent Loop Implementation Plan — Phase 4

**Goal:** Implement the core Session class, SessionEventEmitter (async iterator delivery), the agentic loop (`processInput`), steering/follow-up injection, and loop detection.

**Architecture:** Session orchestrates the agentic loop using `Client.stream()` from `@attractor/llm`. `StreamAccumulator` (exported from `@attractor/llm` via `src/api/stream.ts` → barrel chain) accumulates stream events into an `LLMResponse`. SDK `StreamEvent`s are mapped to agent-level `SessionEvent`s and delivered via an async iterator backed by `SessionEventEmitter`.

**Prerequisite verification:** Before implementation, confirm `StreamAccumulator` is importable: `import { StreamAccumulator } from '@attractor/llm'`. If tsup tree-shakes it from the built output, add it to Phase 1 as an explicit re-export from `packages/llm/src/index.ts`.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only, @attractor/llm (Client, StreamAccumulator, StreamEvent)

**Scope:** 8 phases from original design (phase 4 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC1: Core Agentic Loop
- **coding-agent-loop.AC1.1 Success:** Session created with ProviderProfile, ExecutionEnvironment, and Client; transitions to IDLE
- **coding-agent-loop.AC1.2 Success:** `process_input()` runs the loop: LLM stream → tool execution → loop until natural completion (text-only response)
- **coding-agent-loop.AC1.3 Success:** Natural completion: model responds with no tool calls, loop exits, session returns to IDLE
- **coding-agent-loop.AC1.4 Success:** Multiple sequential inputs work: submit → complete → submit again
- **coding-agent-loop.AC1.5 Failure:** `max_tool_rounds_per_input` reached → loop stops, emits TURN_LIMIT
- **coding-agent-loop.AC1.6 Failure:** `max_turns` across session reached → loop stops, emits TURN_LIMIT
- **coding-agent-loop.AC1.7 Failure:** Abort signal → cancels LLM stream, kills processes, session transitions to CLOSED
- **coding-agent-loop.AC1.8 Success:** Loop detection: repeating tool call pattern (window of 10) triggers SteeringTurn warning and LOOP_DETECTION event

### coding-agent-loop.AC6: Steering
- **coding-agent-loop.AC6.1 Success:** `steer()` queues message, injected after current tool round as SteeringTurn
- **coding-agent-loop.AC6.2 Success:** `followUp()` queues message, processed after current input completes (triggers new process_input cycle)
- **coding-agent-loop.AC6.3 Success:** SteeringTurns converted to user-role messages for the LLM
- **coding-agent-loop.AC6.4 Success:** Steering drained before first LLM call and after each tool round

### coding-agent-loop.AC10: Event System
- **coding-agent-loop.AC10.1 Success:** All 13 EventKind values emitted at correct times during session lifecycle
- **coding-agent-loop.AC10.2 Success:** Events delivered via `AsyncIterable<SessionEvent>` (consumed with `for await`)
- **coding-agent-loop.AC10.3 Success:** `TOOL_CALL_END` carries full untruncated output
- **coding-agent-loop.AC10.4 Success:** `SESSION_START` and `SESSION_END` bracket the session

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: SessionEventEmitter — async iterator delivery

**Verifies:** coding-agent-loop.AC10.1, coding-agent-loop.AC10.2, coding-agent-loop.AC10.4

**Files:**
- Create: `packages/agent/src/session/events.ts`
- Test: `packages/agent/src/session/events.test.ts` (unit)

**Implementation:**

`packages/agent/src/session/events.ts`:

The `SessionEventEmitter` delivers typed `SessionEvent`s via `AsyncIterable<SessionEvent>`. It uses an internal buffer with a resolve/reject pattern:

```typescript
import type { SessionEvent } from '../types/index.js';

export type SessionEventEmitter = {
  readonly emit: (event: SessionEvent) => void;
  readonly complete: () => void;
  readonly error: (err: Error) => void;
  readonly iterator: () => AsyncIterable<SessionEvent>;
};
```

**Internal design:**
- Buffer: `Array<SessionEvent>` for events emitted before consumer calls `next()`
- Waiter: A pending `resolve` function when consumer is waiting and buffer is empty
- `emit(event)`: If waiter exists, resolve it with event. Otherwise push to buffer.
- `complete()`: Set done flag. If waiter exists, resolve with `{ done: true }`.
- `error(err)`: If waiter exists, reject it. Otherwise store error for next `next()` call.
- `iterator()`: Returns an `AsyncIterable<SessionEvent>` with a `[Symbol.asyncIterator]()` method that returns `{ next(): Promise<IteratorResult<SessionEvent>> }`.

Factory function: `createSessionEventEmitter(): SessionEventEmitter`

**Testing:**

Tests must verify:
- coding-agent-loop.AC10.2: Events consumed with `for await` — emit 3 events, consume with loop, verify all received in order
- coding-agent-loop.AC10.4: `complete()` causes the iterator to finish — consumer's `for await` loop exits
- Buffering: Events emitted before consumer starts are delivered
- Backpressure: Consumer waiting for events receives them as they're emitted
- Error delivery: `error()` causes the iterator to throw

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All event emitter tests pass.

**Commit:** `feat(agent): implement SessionEventEmitter with async iterator delivery`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Loop detection

**Verifies:** coding-agent-loop.AC1.8

**Files:**
- Create: `packages/agent/src/session/loop-detection.ts`
- Test: `packages/agent/src/session/loop-detection.test.ts` (unit)

**Implementation:**

`packages/agent/src/session/loop-detection.ts`:

Tracks tool call signatures across a sliding window. Detects repeating patterns of length 1, 2, or 3.

```typescript
export type LoopDetector = {
  readonly record: (toolName: string, argsHash: string) => void;
  readonly check: () => string | null;
  readonly reset: () => void;
};

export function createLoopDetector(windowSize?: number): LoopDetector {
  // Default window: 10
  // Maintains a circular buffer of tool call signatures (toolName + argsHash)
  // check() looks for repeating patterns:
  //   - Pattern length 1: same call repeated N times
  //   - Pattern length 2: alternating pair repeated
  //   - Pattern length 3: repeating triple
  // Returns a warning message if pattern detected, null otherwise
}
```

A "signature" is `toolName + ":" + argsHash` where `argsHash` is a simple deterministic hash of the args (e.g., JSON.stringify sorted keys).

**Testing:**

Tests must verify:
- coding-agent-loop.AC1.8: Repeating pattern length 1 (same call 5+ times) detected
- Repeating pattern length 2 (A,B,A,B,A,B) detected
- Repeating pattern length 3 (A,B,C,A,B,C,A,B,C) detected
- Non-repeating sequence → no detection
- Reset clears history
- Window size respected (old entries dropped)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All loop detection tests pass.

**Commit:** `feat(agent): implement loop detection`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Steering queue

**Verifies:** coding-agent-loop.AC6.1, coding-agent-loop.AC6.2, coding-agent-loop.AC6.3, coding-agent-loop.AC6.4

**Files:**
- Create: `packages/agent/src/session/steering.ts`
- Test: `packages/agent/src/session/steering.test.ts` (unit)

**Implementation:**

`packages/agent/src/session/steering.ts`:

Simple queue management for steering and follow-up messages.

```typescript
import type { SteeringTurn } from '../types/index.js';

export type SteeringQueue = {
  readonly steer: (message: string) => void;
  readonly followUp: (message: string) => void;
  readonly drainSteering: () => ReadonlyArray<SteeringTurn>;
  readonly drainFollowUp: () => ReadonlyArray<string>;
  readonly hasSteering: () => boolean;
  readonly hasFollowUp: () => boolean;
};

export function createSteeringQueue(): SteeringQueue {
  // Two internal queues:
  // - steeringQueue: messages to inject after current tool round (as SteeringTurn)
  // - followUpQueue: messages to process after current input completes (triggers new process_input)
  //
  // drainSteering(): Returns all pending steering messages as SteeringTurn objects, clears queue
  // drainFollowUp(): Returns all pending follow-up messages, clears queue
}
```

**Testing:**

Tests must verify:
- coding-agent-loop.AC6.1: `steer()` queues message, `drainSteering()` returns it as SteeringTurn
- coding-agent-loop.AC6.2: `followUp()` queues message, `drainFollowUp()` returns it
- coding-agent-loop.AC6.4: `drainSteering()` clears the queue (second drain returns empty)
- Multiple messages queued and drained in order

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All steering tests pass.

**Commit:** `feat(agent): implement steering queue`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Session class and agentic loop

**Verifies:** coding-agent-loop.AC1.1, coding-agent-loop.AC1.2, coding-agent-loop.AC1.3, coding-agent-loop.AC1.4, coding-agent-loop.AC1.5, coding-agent-loop.AC1.6, coding-agent-loop.AC1.7, coding-agent-loop.AC10.1, coding-agent-loop.AC10.3

**Files:**
- Create: `packages/agent/src/session/session.ts`
- Create: `packages/agent/src/session/loop.ts`
- Test: `packages/agent/src/session/session.test.ts` (unit)
- Test: `packages/agent/src/session/loop.test.ts` (unit)

**Implementation:**

**`packages/agent/src/session/session.ts`** — The central orchestrator:

```typescript
import type { Client } from '@attractor/llm';
import type { ProviderProfile, ExecutionEnvironment, SessionConfig, SessionState, SessionEvent } from '../types/index.js';

export type SessionOptions = {
  readonly profile: ProviderProfile;
  readonly environment: ExecutionEnvironment;
  readonly client: Client;
  readonly config: SessionConfig;
};

export type Session = {
  readonly submit: (input: string) => Promise<void>;
  readonly steer: (message: string) => void;
  readonly followUp: (message: string) => void;
  readonly abort: () => Promise<void>;
  readonly events: () => AsyncIterable<SessionEvent>;
  readonly state: () => SessionState;
  readonly history: () => ReadonlyArray<Turn>;
};
```

Factory function: `createSession(options: SessionOptions): Session`

**Session lifecycle:**
1. Created → state `IDLE`, emits `SESSION_START`
2. `submit(input)` → state `PROCESSING`, appends `UserTurn`, runs `processInput()`
3. Loop completes → state `IDLE` (or `CLOSED` on error/abort)
4. Follow-ups drained → triggers another `processInput()` cycle
5. `abort()` → cancels stream, kills processes, emits `SESSION_END`, state `CLOSED`

**`packages/agent/src/session/loop.ts`** — The core agentic loop:

```typescript
export async function processInput(context: LoopContext): Promise<void> {
  // The core loop:
  // 1. Drain steering queue, append SteeringTurns to history
  // 2. Build LLMRequest from history (messages + tools from profile)
  //    Set request.signal = abortController.signal (abort via LLMRequest.signal field)
  // 3. Call client.stream(request) — abort propagated via request.signal
  // 4. For each StreamEvent:
  //    - Map to SessionEvent, emit via event emitter
  //    - Accumulate into StreamAccumulator
  // 5. After stream finishes:
  //    - Build AssistantTurn from accumulated response
  //    - Append to history
  //    - Extract tool calls from response content
  // 6. If no tool calls → BREAK (natural completion, AC1.3)
  // 7. If tool calls present:
  //    - Check max_tool_rounds_per_input limit (AC1.5)
  //    - Execute tools via dispatchToolCalls()
  //    - For each result: emit TOOL_CALL_END with FULL untruncated output (AC10.3)
  //    - Truncate output for LLM
  //    - Build ToolResultsTurn, append to history
  //    - Record tool call signatures for loop detection (AC1.8)
  //    - Drain steering queue
  //    - Loop back to step 2
  // 8. Check max_turns across session (AC1.6)
  // 9. Check for abort signal (AC1.7)
}
```

**History → Messages conversion** (within the loop):

```typescript
function historyToMessages(history: ReadonlyArray<Turn>): ReadonlyArray<Message> {
  // UserTurn → userMessage(content)
  // SteeringTurn → userMessage(content) (user-role for the LLM, AC6.3)
  // SystemTurn → userMessage(content) (system-injected, user-role)
  // AssistantTurn → assistantMessage(contentParts)
  // ToolResultsTurn → one toolMessage() per result
}
```

Uses `userMessage()`, `assistantMessage()`, `toolMessage()` from `@attractor/llm`.

**SDK StreamEvent → Agent SessionEvent mapping:**

| SDK StreamEvent (`type`) | Agent SessionEvent (`kind`) | Notes |
|---|---|---|
| `STREAM_START` | `ASSISTANT_TEXT_START` | Start of assistant response |
| `TEXT_DELTA` | `ASSISTANT_TEXT_DELTA` | Incremental text chunk |
| `THINKING_DELTA` | `THINKING_DELTA` | Extended thinking chunk |
| `TOOL_CALL_START` | `TOOL_CALL_START` | Includes toolCallId, toolName, args |
| `TOOL_CALL_DELTA` | *(accumulated, not emitted)* | Partial args accumulated internally |
| `TOOL_CALL_END` | *(triggers tool execution)* | Loop executes tool, emits TOOL_CALL_END after execution |
| `STEP_FINISH` | *(internal bookkeeping)* | Step boundary for multi-step responses |
| `FINISH` | `ASSISTANT_TEXT_END` | End of assistant response |

Agent-only events (no SDK equivalent):
- `SESSION_START` / `SESSION_END`: Session lifecycle
- `TOOL_CALL_END`: Emitted after tool execution with full untruncated output
- `TURN_LIMIT`, `LOOP_DETECTION`, `CONTEXT_WARNING`, `ERROR`, `SUBAGENT_EVENT`

**Testing:**

Tests use a **mock Client** that returns predefined `StreamEvent` sequences. This enables deterministic testing of the loop without real API calls.

Mock Client pattern:
```typescript
function createMockClient(responses: Array<Array<StreamEvent>>): Client {
  // Returns a Client-like object where each call to stream() yields the next response
}
```

Tests must verify each AC:
- coding-agent-loop.AC1.1: Session created → state is IDLE
- coding-agent-loop.AC1.2: Submit input → loop streams, executes tools, loops
- coding-agent-loop.AC1.3: Model responds with text only (no tool calls) → loop exits, state returns to IDLE
- coding-agent-loop.AC1.4: Two sequential submits → both complete, state returns to IDLE each time
- coding-agent-loop.AC1.5: Set `maxToolRoundsPerInput: 2`, model requests tools 3 times → loop stops after 2 rounds, emits TURN_LIMIT
- coding-agent-loop.AC1.6: Set `maxTurns: 3`, submit inputs until limit → loop stops, emits TURN_LIMIT
- coding-agent-loop.AC1.7: Abort during streaming → stream cancelled, state transitions to CLOSED
- coding-agent-loop.AC1.8: Mock repeating tool calls → loop detection fires, emits LOOP_DETECTION, injects SteeringTurn warning
- coding-agent-loop.AC6.1: `steer()` during processing → message injected after tool round
- coding-agent-loop.AC6.2: `followUp()` → new processInput cycle after current completes
- coding-agent-loop.AC6.3: SteeringTurns appear as user-role messages in the request
- coding-agent-loop.AC6.4: Steering drained before first LLM call and after each tool round
- coding-agent-loop.AC10.1: All relevant EventKind values emitted during a full loop cycle
- coding-agent-loop.AC10.3: TOOL_CALL_END events carry full untruncated output

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All session and loop tests pass.

**Commit:** `feat(agent): implement Session class and agentic loop`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update session barrel export

**Files:**
- Modify: `packages/agent/src/session/index.ts`

**Implementation:**

```typescript
export * from './events.js';
export * from './loop-detection.js';
export * from './steering.js';
export * from './session.js';
export * from './loop.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

**Commit:** `chore(agent): update session barrel export`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Final verification — build and all tests

**Files:** None (verification only)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass (previous phases + event emitter + loop detection + steering + session + loop).

**Commit:** Not needed unless fixes are required.

<!-- END_TASK_6 -->
