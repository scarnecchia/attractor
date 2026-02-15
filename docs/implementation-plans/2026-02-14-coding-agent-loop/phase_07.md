# Coding Agent Loop Implementation Plan — Phase 7

**Goal:** Implement subagent spawning, communication, and lifecycle management. Subagents are child Sessions with independent history that share the parent's ExecutionEnvironment.

**Architecture:** A `SubAgentHandle` wraps a child `Session` with lifecycle tracking. Four subagent tools (`spawn_agent`, `send_input`, `wait`, `close_agent`) are registered on all profiles. Executor closures bind to a parent Session's subagent map. Depth limiting prevents sub-sub-agents.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only

**Scope:** 8 phases from original design (phase 7 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC7: Subagents
- **coding-agent-loop.AC7.1 Success:** `spawn_agent` creates child Session with independent history and shared ExecutionEnvironment
- **coding-agent-loop.AC7.2 Success:** Subagent uses parent's ProviderProfile (or overridden model)
- **coding-agent-loop.AC7.3 Success:** `send_input` queues a message to child; `wait` blocks until child completes
- **coding-agent-loop.AC7.4 Success:** `close_agent` aborts child session
- **coding-agent-loop.AC7.5 Failure:** Depth limiting: child cannot spawn sub-children (maxSubagentDepth=1 default)
- **coding-agent-loop.AC7.6 Success:** Subagent results returned to parent as tool results (output, success, turnsUsed)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Subagent types and handle

**Files:**
- Create: `packages/agent/src/subagent/subagent.ts`
- Create: `packages/agent/src/subagent/index.ts`

**Implementation:**

`packages/agent/src/subagent/subagent.ts`:

```typescript
import type { Session } from '../session/session.js';

export type SubAgentStatus = 'running' | 'completed' | 'aborted' | 'error';

export type SubAgentResult = {
  readonly output: string;
  readonly success: boolean;
  readonly turnsUsed: number;
};

export type SubAgentHandle = {
  readonly id: string;
  readonly session: Session;
  readonly status: () => SubAgentStatus;
  readonly result: () => SubAgentResult | null;
};

export type SubAgentMap = {
  readonly spawn: (id: string, session: Session) => SubAgentHandle;
  readonly get: (id: string) => SubAgentHandle | null;
  readonly close: (id: string) => void;
  readonly closeAll: () => void;
  readonly list: () => ReadonlyArray<SubAgentHandle>;
};

export function createSubAgentMap(): SubAgentMap {
  // Internal Map<string, SubAgentHandle>
  //
  // spawn(id, session): Creates a SubAgentHandle wrapping the session.
  //   Tracks status as 'running'. Returns the handle.
  //   Throws if id already exists.
  //
  // get(id): Returns handle or null.
  //
  // close(id): Calls session.abort() on the child, sets status to 'aborted'.
  //   No-op if already completed/aborted.
  //
  // closeAll(): Iterates all handles, closes running ones.
  //   Called during parent session shutdown (graceful shutdown).
  //
  // list(): Returns all handles as readonly array.
}
```

`packages/agent/src/subagent/index.ts`:

```typescript
export * from './subagent.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

**Commit:** `feat(agent): add subagent types and handle`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Subagent tool executors

**Verifies:** coding-agent-loop.AC7.1, coding-agent-loop.AC7.2, coding-agent-loop.AC7.3, coding-agent-loop.AC7.4, coding-agent-loop.AC7.5, coding-agent-loop.AC7.6

**Files:**
- Create: `packages/agent/src/subagent/tools.ts`
- Test: `packages/agent/src/subagent/subagent.test.ts` (unit)

**Implementation:**

`packages/agent/src/subagent/tools.ts`:

Provides factory functions that create `RegisteredTool` objects for the four subagent tools. Each factory takes a closure over the parent session's context (subagent map, environment, profile, client, depth).

```typescript
import type { RegisteredTool } from '../types/index.js';
import type { SubAgentMap } from './subagent.js';
import type { Session, SessionOptions } from '../session/session.js';
import type { Client } from '@attractor/llm';
import type { ProviderProfile, ExecutionEnvironment, SessionConfig } from '../types/index.js';

export type SubAgentToolContext = {
  readonly subagents: SubAgentMap;
  readonly environment: ExecutionEnvironment;
  readonly profile: ProviderProfile;
  readonly client: Client;
  readonly config: SessionConfig;
  readonly currentDepth: number;
};

export function createSubAgentTools(context: SubAgentToolContext): ReadonlyArray<RegisteredTool> {
  // Returns array of 4 RegisteredTool objects:
  return [
    createSpawnAgentTool(context),
    createSendInputTool(context),
    createWaitTool(context),
    createCloseAgentTool(context),
  ];
}
```

**`spawn_agent` tool:**
```typescript
function createSpawnAgentTool(context: SubAgentToolContext): RegisteredTool {
  // Definition:
  //   name: 'spawn_agent'
  //   parameters: {
  //     id: string (required) — unique identifier for the subagent
  //     instruction: string (required) — initial input for the child
  //     model?: string — override parent's model
  //     max_turns?: number — turn limit for the child
  //   }
  //
  // Executor:
  //   1. Check depth: if currentDepth >= maxSubagentDepth (default 1),
  //      return error: "Maximum subagent depth exceeded"
  //   2. Create child SessionOptions:
  //      - Same environment (shared filesystem)
  //      - Same profile (or with overridden model)
  //      - Same client
  //      - Config with maxTurns from args (or default), depth = currentDepth + 1
  //   3. Create child Session via createSession(childOptions)
  //      (createSession is from Phase 4 — already implemented at this point)
  //   4. Register in subagent map via context.subagents.spawn(id, childSession)
  //   5. Call childSession.submit(instruction) — starts the child loop
  //   6. Return success: "Subagent {id} spawned"
}
```

**`send_input` tool:**
```typescript
function createSendInputTool(context: SubAgentToolContext): RegisteredTool {
  // Definition:
  //   name: 'send_input'
  //   parameters: {
  //     id: string (required) — subagent identifier
  //     message: string (required) — message to send
  //   }
  //
  // Executor:
  //   1. Look up subagent by id
  //   2. If not found or not running, return error
  //   3. Call subagent.session.submit(message) — queues new input
  //   4. Return success: "Message sent to subagent {id}"
}
```

**`wait` tool:**
```typescript
function createWaitTool(context: SubAgentToolContext): RegisteredTool {
  // Definition:
  //   name: 'wait'
  //   parameters: {
  //     id: string (required) — subagent identifier
  //   }
  //
  // Executor:
  //   1. Look up subagent by id
  //   2. If not found, return error
  //   3. Consume events from subagent.session.events() until done
  //      (SESSION_END or state becomes IDLE/CLOSED)
  //   4. Collect final assistant text from the child's history
  //   5. Return SubAgentResult as JSON string:
  //      { output: string, success: boolean, turnsUsed: number }
}
```

**`close_agent` tool:**
```typescript
function createCloseAgentTool(context: SubAgentToolContext): RegisteredTool {
  // Definition:
  //   name: 'close_agent'
  //   parameters: {
  //     id: string (required) — subagent identifier
  //   }
  //
  // Executor:
  //   1. Look up subagent by id
  //   2. If not found, return error
  //   3. Call context.subagents.close(id) — aborts child session
  //   4. Return success: "Subagent {id} closed"
}
```

**Testing:**

Tests use mock Session and Client objects (from Phase 4's mock patterns).

Tests must verify:
- coding-agent-loop.AC7.1: `spawn_agent` creates a child Session with independent history. After spawn, child's `history()` is empty (independent from parent). Child uses the same ExecutionEnvironment as parent.
- coding-agent-loop.AC7.2: Default spawn uses parent's profile. When `model` arg is provided, child's config uses the overridden model.
- coding-agent-loop.AC7.3: `send_input` queues message to child (child's `submit()` called). `wait` blocks until child completes and returns `SubAgentResult` with output, success, turnsUsed.
- coding-agent-loop.AC7.4: `close_agent` calls abort on child session. After close, child's state is CLOSED.
- coding-agent-loop.AC7.5: When `currentDepth >= maxSubagentDepth`, `spawn_agent` returns error result (not exception). Default maxSubagentDepth is 1, so depth-0 parent can spawn depth-1 child, but depth-1 child cannot spawn depth-2.
- coding-agent-loop.AC7.6: `wait` returns result with `output` (last assistant text), `success` (true if natural completion, false if error/abort), `turnsUsed` (number of tool rounds).

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All subagent tests pass.

**Commit:** `feat(agent): implement subagent tools and lifecycle`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Register subagent tools from Session (post-construction)

**Files:**
- Modify: `packages/agent/src/session/session.ts`
- Test: `packages/agent/src/subagent/subagent.test.ts` (extend existing tests)

**Implementation:**

**Do NOT modify profile factory functions.** Profile factories remain pure (no Session dependency). Instead, the Session constructor registers subagent tools on the profile's `toolRegistry` after profile creation. This avoids a circular dependency: Session → ProviderProfile → SubAgentToolContext → Session.

The Session constructor (implemented in Phase 4, Task 4) already has access to everything `SubAgentToolContext` needs. After creating the profile and subagent map, Session registers the tools:

```typescript
// In Session constructor (packages/agent/src/session/session.ts):
// 1. Create profile via factory (no subagent context needed)
// 2. Create subagent map via createSubAgentMap()
// 3. Build SubAgentToolContext from session's own fields
// 4. Register subagent tools on profile's registry:

import { createSubAgentTools, type SubAgentToolContext } from '../subagent/tools.js';

// Inside Session constructor, AFTER profile and subagentMap are created:
const subAgentContext: SubAgentToolContext = {
  subagents: this.subagentMap,
  environment: this.environment,
  profile: this.profile,
  client: this.client,
  config: this.config,
  currentDepth: options.depth ?? 0,
};

for (const tool of createSubAgentTools(subAgentContext)) {
  this.profile.toolRegistry.register(tool);
}
```

**Key design decision:** Subagent tools are registered at Session construction time, not at profile factory time. This means:
- Profile factories have **zero** knowledge of subagents or Sessions
- No circular imports between profiles/ and session/ modules
- The import direction is one-way: `session/` → `subagent/` → `types/`
- Profiles are still independently testable without Session

**Testing (extend subagent.test.ts):**

Add tests verifying that when a Session-like setup registers subagent tools on a profile's registry:
- All four tools (`spawn_agent`, `send_input`, `wait`, `close_agent`) appear in `profile.toolRegistry.list()`
- Profile's original tools (e.g., `shell`, `edit_file`) are still present after registration
- Registration is additive (latest-wins semantics from Phase 2 ToolRegistry)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass including subagent registration tests.

**Commit:** `feat(agent): register subagent tools from Session post-construction`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update subagent barrel export and final verification

**Files:**
- Modify: `packages/agent/src/subagent/index.ts`

**Implementation:**

```typescript
export * from './subagent.js';
export * from './tools.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass (previous phases + subagent types + subagent tools + profile registration).

**Commit:** `chore(agent): update subagent barrel export`

<!-- END_TASK_4 -->
