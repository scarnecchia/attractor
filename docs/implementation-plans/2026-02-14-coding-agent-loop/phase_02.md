# Coding Agent Loop Implementation Plan — Phase 2

**Goal:** Define all core types (SessionConfig, SessionState, SessionEvent, Turn types, ProviderProfile, ExecutionEnvironment, ToolRegistry) and implement `LocalExecutionEnvironment`.

**Architecture:** Types in `packages/agent/src/types/` follow the same conventions as `@attractor/llm` — readonly fields, discriminated unions, standalone helper functions. `LocalExecutionEnvironment` in `packages/agent/src/execution/local.ts` implements the `ExecutionEnvironment` interface using Node.js `node:fs`, `node:child_process`, and `tinyglobby`.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only, tinyglobby (glob), node:child_process (process groups)

**Scope:** 8 phases from original design (phase 2 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC4: Execution Environment
- **coding-agent-loop.AC4.1 Success:** `LocalExecutionEnvironment` reads files with line numbers, respects offset/limit
- **coding-agent-loop.AC4.2 Success:** `LocalExecutionEnvironment` writes files, creates parent directories
- **coding-agent-loop.AC4.3 Success:** Command execution spawns in process group, captures stdout/stderr, records duration
- **coding-agent-loop.AC4.4 Success:** Command timeout default is 10s; overridable per-call via `timeout_ms`
- **coding-agent-loop.AC4.5 Failure:** Timed-out command: process group receives SIGTERM, then SIGKILL after 2s; timeout message in output
- **coding-agent-loop.AC4.6 Success:** Env var filtering excludes `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL` by default; always includes PATH, HOME, etc.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Core type definitions — session, turn, event

**Files:**
- Create: `packages/agent/src/types/session.ts`
- Create: `packages/agent/src/types/turn.ts`
- Create: `packages/agent/src/types/event.ts`

**Implementation:**

**`packages/agent/src/types/session.ts`** — Session configuration and state:

```typescript
import type { ContentPart } from '@attractor/llm';

export type SessionState = 'IDLE' | 'PROCESSING' | 'AWAITING_INPUT' | 'CLOSED';

export type SessionConfig = {
  readonly model: string;
  readonly provider: string;
  readonly maxToolRoundsPerInput?: number;
  readonly maxTurns?: number;
  readonly contextWindowSize?: number;
  readonly toolOutputLimits?: Readonly<Record<string, number>>;
  readonly toolLineLimits?: Readonly<Record<string, number>>;
  readonly loopDetectionWindow?: number;
  readonly maxSubagentDepth?: number;
  readonly defaultCommandTimeout?: number;
  readonly userInstruction?: string;
  readonly workingDirectory?: string;
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
};
```

**`packages/agent/src/types/turn.ts`** — Conversation history turn types (discriminated union on `kind` field):

```typescript
import type { ContentPart } from '@attractor/llm';

export type UserTurn = {
  readonly kind: 'user';
  readonly content: string;
};

export type AssistantTurn = {
  readonly kind: 'assistant';
  readonly content: ReadonlyArray<ContentPart>;
};

export type ToolResultsTurn = {
  readonly kind: 'tool_results';
  readonly results: ReadonlyArray<ToolResultEntry>;
};

export type ToolResultEntry = {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
};

export type SystemTurn = {
  readonly kind: 'system';
  readonly content: string;
};

export type SteeringTurn = {
  readonly kind: 'steering';
  readonly content: string;
};

export type Turn =
  | UserTurn
  | AssistantTurn
  | ToolResultsTurn
  | SystemTurn
  | SteeringTurn;
```

**`packages/agent/src/types/event.ts`** — Session event types (discriminated union on `kind` field):

```typescript
export type EventKind =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'ASSISTANT_TEXT_START'
  | 'ASSISTANT_TEXT_DELTA'
  | 'ASSISTANT_TEXT_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_END'
  | 'THINKING_DELTA'
  | 'TURN_LIMIT'
  | 'LOOP_DETECTION'
  | 'CONTEXT_WARNING'
  | 'ERROR'
  | 'SUBAGENT_EVENT';

export type SessionEvent =
  | { readonly kind: 'SESSION_START'; readonly sessionId: string }
  | { readonly kind: 'SESSION_END'; readonly sessionId: string }
  | { readonly kind: 'ASSISTANT_TEXT_START' }
  | { readonly kind: 'ASSISTANT_TEXT_DELTA'; readonly text: string }
  | { readonly kind: 'ASSISTANT_TEXT_END' }
  | { readonly kind: 'TOOL_CALL_START'; readonly toolCallId: string; readonly toolName: string; readonly args: Record<string, unknown> }
  | { readonly kind: 'TOOL_CALL_END'; readonly toolCallId: string; readonly toolName: string; readonly output: string; readonly isError: boolean }
  | { readonly kind: 'THINKING_DELTA'; readonly text: string }
  | { readonly kind: 'TURN_LIMIT'; readonly reason: 'max_tool_rounds' | 'max_turns' }
  | { readonly kind: 'LOOP_DETECTION'; readonly message: string }
  | { readonly kind: 'CONTEXT_WARNING'; readonly usagePercent: number }
  | { readonly kind: 'ERROR'; readonly error: Error }
  | { readonly kind: 'SUBAGENT_EVENT'; readonly subagentId: string; readonly event: SessionEvent };
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

**Commit:** `feat(agent): add core type definitions (session, turn, event)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Type definitions — profile, environment, tool

**Files:**
- Create: `packages/agent/src/types/profile.ts`
- Create: `packages/agent/src/types/environment.ts`
- Create: `packages/agent/src/types/tool.ts`

**Implementation:**

**`packages/agent/src/types/profile.ts`** — Provider profile interface:

```typescript
import type { ToolRegistry } from './tool.js';

export type ProfileId = 'openai' | 'anthropic' | 'gemini';

export type ProviderProfile = {
  readonly id: ProfileId;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly toolRegistry: ToolRegistry;
  readonly supportsParallelToolCalls: boolean;
  readonly buildSystemPrompt: (context: SystemPromptContext) => string;
  readonly projectDocFiles: ReadonlyArray<string>;
  readonly defaultCommandTimeout: number;
};

export type SystemPromptContext = {
  readonly platform: string;
  readonly osVersion: string;
  readonly workingDirectory: string;
  readonly gitBranch: string | null;
  readonly gitStatus: string | null;
  readonly gitLog: string | null;
  readonly date: string;
  readonly model: string;
  readonly projectDocs: string;
  readonly userInstruction: string | null;
};
```

**`packages/agent/src/types/environment.ts`** — Execution environment interface:

```typescript
export type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly durationMs: number;
};

export type DirEntry = {
  readonly name: string;
  readonly isDir: boolean;
  readonly size: number | null;
};

export type GrepOptions = {
  readonly caseSensitive?: boolean;
  readonly maxResults?: number;
  readonly includePattern?: string;
  readonly contextLines?: number;
};

export type EnvVarPolicy = 'inherit_all' | 'inherit_core' | 'inherit_none';

export type ExecutionEnvironment = {
  readonly readFile: (path: string, offset?: number, limit?: number) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly deleteFile: (path: string) => Promise<void>;
  readonly fileExists: (path: string) => Promise<boolean>;
  readonly listDirectory: (path: string, depth?: number) => Promise<ReadonlyArray<DirEntry>>;
  readonly execCommand: (
    command: string,
    timeoutMs?: number,
    workingDir?: string,
    envVars?: Readonly<Record<string, string>>,
  ) => Promise<ExecResult>;
  readonly grep: (pattern: string, path: string, options?: GrepOptions) => Promise<string>;
  readonly glob: (pattern: string, path: string) => Promise<ReadonlyArray<string>>;
  readonly initialize: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
  readonly workingDirectory: () => string;
  readonly platform: () => string;
  readonly osVersion: () => string;
};
```

**`packages/agent/src/types/tool.ts`** — Tool registry:

```typescript
import type { ExecutionEnvironment } from './environment.js';

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  env: ExecutionEnvironment,
) => Promise<string>;

export type RegisteredTool = {
  readonly definition: ToolDefinition;
  readonly executor: ToolExecutor;
};

/**
 * Mutable container by design. ToolRegistry holds a Map<string, RegisteredTool>
 * that is modified via register()/unregister() at runtime — e.g., Session
 * registers subagent tools post-construction (Phase 7). The `readonly` modifiers
 * on fields prevent reassignment of the method references, not mutation of
 * internal state. This is the intended exception to the project's immutability-
 * by-default convention.
 */
export type ToolRegistry = {
  readonly register: (tool: RegisteredTool) => void;
  readonly unregister: (name: string) => void;
  readonly get: (name: string) => RegisteredTool | null;
  readonly definitions: () => ReadonlyArray<ToolDefinition>;
  readonly list: () => ReadonlyArray<RegisteredTool>;
};

export function createToolRegistry(initial?: ReadonlyArray<RegisteredTool>): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();

  if (initial) {
    for (const tool of initial) {
      tools.set(tool.definition.name, tool);
    }
  }

  return {
    register(tool: RegisteredTool): void {
      tools.set(tool.definition.name, tool);
    },
    unregister(name: string): void {
      tools.delete(name);
    },
    get(name: string): RegisteredTool | null {
      return tools.get(name) ?? null;
    },
    definitions(): ReadonlyArray<ToolDefinition> {
      return Array.from(tools.values()).map((t) => t.definition);
    },
    list(): ReadonlyArray<RegisteredTool> {
      return Array.from(tools.values());
    },
  };
}
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

**Commit:** `feat(agent): add profile, environment, and tool type definitions`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update types barrel export

**Files:**
- Modify: `packages/agent/src/types/index.ts`

**Implementation:**

Update the barrel export to re-export all type modules:

```typescript
export * from './session.js';
export * from './turn.js';
export * from './event.js';
export * from './profile.js';
export * from './environment.js';
export * from './tool.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

**Commit:** `chore(agent): update types barrel export`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Add tinyglobby dependency

**Files:**
- Modify: `packages/agent/package.json` (add tinyglobby)

**Implementation:**

Add `tinyglobby` to the agent package's runtime dependencies:

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm install tinyglobby`

This adds tinyglobby for the `glob()` method in `LocalExecutionEnvironment`.

**Verification:**

Run: `cd /Users/scarndp/dev/attractor && npm install`
Expected: Installs without errors.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && node -e "import('tinyglobby').then(m => console.log('ok'))"`
Expected: Prints "ok".

**Commit:** `chore(agent): add tinyglobby dependency`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: LocalExecutionEnvironment implementation

**Verifies:** coding-agent-loop.AC4.1, coding-agent-loop.AC4.2, coding-agent-loop.AC4.3, coding-agent-loop.AC4.4, coding-agent-loop.AC4.5, coding-agent-loop.AC4.6

**Files:**
- Create: `packages/agent/src/execution/local.ts`
- Modify: `packages/agent/src/execution/index.ts`
- Test: `packages/agent/src/execution/local.test.ts` (unit)

**Implementation:**

Create `LocalExecutionEnvironment` implementing the `ExecutionEnvironment` interface. This is the most substantial file in Phase 2. Key implementation details:

**File operations (`readFile`, `writeFile`, `deleteFile`, `fileExists`, `listDirectory`):**
- Use `node:fs/promises` for all file I/O
- `readFile`: Read file, split into lines, prepend line numbers (1-based, tab-separated), respect `offset` (0-based line index) and `limit` (number of lines). Format: `     1\tline content` (right-aligned line number, tab, content).
- `writeFile`: Write content, create parent directories with `mkdir -p` equivalent (`{ recursive: true }`)
- `deleteFile`: Delete file using `fs.unlink()`. Throws if file does not exist. Required for `apply_patch` Delete File operations.
- `fileExists`: Use `fs.access()` with try/catch
- `listDirectory`: Use `fs.readdir()` with `{ withFileTypes: true }`, return `DirEntry` array. `depth` parameter controls recursion (default 1 = immediate children only).
- All paths resolved relative to `workingDirectory` using `node:path.resolve()`

**Command execution (`execCommand`):**
- Use `node:child_process.spawn()` with `{ shell: true, detached: true }` to create a process group
- On macOS/Linux: shell is `/bin/bash -c`, on Windows: `cmd.exe /c`
- Default timeout: 10,000ms (overridable per-call)
- Timeout handling: `setTimeout` → `process.kill(-pid, 'SIGTERM')` → wait 2s → `process.kill(-pid, 'SIGKILL')`
- Capture stdout and stderr into buffers via `on('data')` events
- Record `durationMs` via `Date.now()` delta
- Support `AbortSignal` propagation (from session abort)

**Environment variable filtering (`execCommand`):**
- Default policy: `inherit_core`
- Sensitive patterns (case-insensitive): `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL`
- Always included: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `TMPDIR`, `GOPATH`, `CARGO_HOME`, `NVM_DIR`, `RUSTUP_HOME`, `PYENV_ROOT`, `JAVA_HOME`, `NODE_PATH`
- Merge caller-provided `envVars` on top (overrides filtered env)

**Search operations (`grep`, `glob`):**
- `grep`: Try `rg` (ripgrep) first via `execCommand('rg ...')`. If `rg` not found (exit code indicates not installed), fall back to regex-based search using `node:fs` + `RegExp`. Support case sensitivity, max results, include pattern, context lines.
- `glob`: Use `tinyglobby` with the provided pattern and path.

**Metadata (`workingDirectory`, `platform`, `osVersion`):**
- `workingDirectory()`: Return the configured working directory
- `platform()`: Return `process.platform` (maps to `'darwin'`, `'linux'`, `'win32'`)
- `osVersion()`: Return `os.release()` from `node:os`

**Lifecycle (`initialize`, `cleanup`):**
- `initialize()`: Verify working directory exists, no-op otherwise
- `cleanup()`: No-op for local environment

**Factory function:**

```typescript
export function createLocalExecutionEnvironment(
  workingDir: string,
  envVarPolicy?: EnvVarPolicy,
): ExecutionEnvironment {
  // implementation
}
```

Update `packages/agent/src/execution/index.ts`:
```typescript
export * from './local.js';
```

**Testing:**

Tests must verify each AC:
- coding-agent-loop.AC4.1: `readFile` returns content with line numbers, respects offset/limit, handles missing files with error
- coding-agent-loop.AC4.2: `writeFile` creates files, creates parent directories that don't exist
- coding-agent-loop.AC4.3: `execCommand` captures stdout and stderr, records duration, returns exit code
- coding-agent-loop.AC4.4: `execCommand` default timeout is 10s; passing a custom `timeout_ms` overrides it
- coding-agent-loop.AC4.5: `execCommand` with a command that exceeds timeout results in `timedOut: true` and timeout message in output
- coding-agent-loop.AC4.6: Environment variable filtering excludes sensitive vars, includes core vars

Test approach:
- Use temporary directories (`node:os.tmpdir()` + random suffix) for file operation tests
- Use simple shell commands (`echo`, `cat`, `sleep`) for command execution tests
- For timeout tests, use `sleep 30` with a short timeout (100ms)
- For env var filtering, spawn a command that prints env vars and verify sensitive ones are excluded
- Clean up temp directories in `afterEach`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All LocalExecutionEnvironment tests pass.

**Commit:** `feat(agent): implement LocalExecutionEnvironment`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: ToolRegistry unit tests

**Verifies:** (supports coding-agent-loop.AC2.5, coding-agent-loop.AC2.6 — tested here, verified in Phase 6)

**Files:**
- Test: `packages/agent/src/types/tool.test.ts` (unit)

**Implementation:**

The `createToolRegistry()` function is already implemented in Task 2. This task adds unit tests.

**Testing:**

Tests must verify:
- `register()` adds a tool, `get()` retrieves it
- `register()` with same name overwrites (latest-wins for name collisions — supports AC2.6)
- `unregister()` removes a tool, `get()` returns null
- `definitions()` returns all tool definitions
- `list()` returns all registered tools
- Initial tools passed to `createToolRegistry()` are registered
- Empty registry returns empty arrays from `definitions()` and `list()`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All ToolRegistry tests pass.

**Commit:** `test(agent): add ToolRegistry unit tests`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: Final verification — build and all tests

**Files:** None (verification only)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass (LocalExecutionEnvironment + ToolRegistry).

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npm test`
Expected: Existing LLM tests still pass (no regressions).

**Commit:** Not needed unless fixes are required.

<!-- END_TASK_7 -->
