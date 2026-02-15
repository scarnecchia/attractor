# Coding Agent Loop Implementation Plan — Phase 3

**Goal:** Implement all shared tool executors (read-file, write-file, edit-file, apply-patch, shell, grep, glob) and the two-stage output truncation pipeline.

**Architecture:** Each tool is a standalone executor function `(args, env) => Promise<string>` that delegates I/O to the `ExecutionEnvironment` interface. The truncation pipeline runs character-based truncation first (head_tail or tail mode), then optional line-based truncation.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only

**Scope:** 8 phases from original design (phase 3 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC3: Tool Execution
- **coding-agent-loop.AC3.1 Success:** Tool calls dispatched through ToolRegistry, executor receives (args, executionEnv)
- **coding-agent-loop.AC3.2 Failure:** Unknown tool name → error result returned to LLM (is_error: true), not an exception
- **coding-agent-loop.AC3.3 Failure:** Invalid JSON arguments → validation error result returned to LLM
- **coding-agent-loop.AC3.4 Failure:** Tool execution throws → caught, returned as error result
- **coding-agent-loop.AC3.5 Success:** Parallel tool execution works when profile's `supportsParallelToolCalls` is true (Promise.allSettled)

### coding-agent-loop.AC5: Tool Output Truncation
- **coding-agent-loop.AC5.1 Success:** Character-based truncation runs FIRST on all tool outputs
- **coding-agent-loop.AC5.2 Success:** Line-based truncation runs SECOND where configured (shell: 256, grep: 200, glob: 500)
- **coding-agent-loop.AC5.3 Success:** head_tail mode keeps first half + last half of chars with WARNING marker
- **coding-agent-loop.AC5.4 Success:** tail mode drops beginning, keeps end with WARNING marker
- **coding-agent-loop.AC5.5 Edge:** Pathological input (10MB single line) handled by character truncation before line truncation sees it
- **coding-agent-loop.AC5.6 Success:** Default character limits match spec (read_file: 50k, shell: 30k, grep: 20k, etc.); all overridable via SessionConfig

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Truncation pipeline implementation

**Verifies:** coding-agent-loop.AC5.1, coding-agent-loop.AC5.2, coding-agent-loop.AC5.3, coding-agent-loop.AC5.4, coding-agent-loop.AC5.5, coding-agent-loop.AC5.6

**Files:**
- Create: `packages/agent/src/truncation/truncate.ts`
- Modify: `packages/agent/src/truncation/index.ts`
- Test: `packages/agent/src/truncation/truncate.test.ts` (unit)

**Implementation:**

`packages/agent/src/truncation/truncate.ts`:

The truncation module implements a two-stage pipeline:

**Stage 1: Character-based truncation** — `truncateChars(output, maxChars, mode)`

Two modes:
- `head_tail`: Keep first `maxChars/2` chars + WARNING marker + last `maxChars/2` chars. WARNING text: `"\n\n[WARNING: Tool output was truncated. {removed} characters were removed from the middle. The full output is available in the event stream. If you need to see specific parts, re-run the tool with more targeted parameters.]\n\n"`
- `tail`: Drop beginning, keep last `maxChars` chars. WARNING text: `"[WARNING: Tool output was truncated. First {removed} characters were removed. The full output is available in the event stream.]\n\n"`

If `output.length <= maxChars`, return unchanged.

**Stage 2: Line-based truncation** — `truncateLines(output, maxLines)`

Uses head_tail split on lines. If output has `<= maxLines` lines, return unchanged. Otherwise keep first `maxLines/2` lines + line-based WARNING marker + last `maxLines/2` lines.

**Pipeline function** — `truncateToolOutput(output, toolName, config?)`:

```typescript
export type TruncationMode = 'head_tail' | 'tail';

export type TruncationConfig = {
  readonly toolOutputLimits?: Readonly<Record<string, number>>;
  readonly toolLineLimits?: Readonly<Record<string, number>>;
};

export const DEFAULT_CHAR_LIMITS: Readonly<Record<string, number>> = {
  read_file: 50_000,
  shell: 30_000,
  grep: 20_000,
  glob: 20_000,
  edit_file: 10_000,
  apply_patch: 10_000,
  write_file: 1_000,
  spawn_agent: 20_000,
};

export const DEFAULT_TRUNCATION_MODES: Readonly<Record<string, TruncationMode>> = {
  read_file: 'head_tail',
  shell: 'head_tail',
  grep: 'tail',
  glob: 'tail',
  edit_file: 'tail',
  apply_patch: 'tail',
  write_file: 'tail',
  spawn_agent: 'head_tail',
};

export const DEFAULT_LINE_LIMITS: Readonly<Record<string, number | null>> = {
  shell: 256,
  grep: 200,
  glob: 500,
  read_file: null,
  edit_file: null,
};

export function truncateToolOutput(
  output: string,
  toolName: string,
  config?: TruncationConfig,
): string {
  // Step 1: Character-based truncation (ALWAYS first)
  // Step 2: Line-based truncation (where configured)
}
```

Export `truncateChars` and `truncateLines` as well — they're useful for testing independently.

Update `packages/agent/src/truncation/index.ts`:
```typescript
export * from './truncate.js';
```

**Testing:**

Tests must verify each AC:
- coding-agent-loop.AC5.1: Character truncation runs first — pass output exceeding both char and line limits, verify char truncation happened before line truncation
- coding-agent-loop.AC5.2: Line truncation runs second — shell output within char limit but exceeding 256 lines gets line-truncated
- coding-agent-loop.AC5.3: `head_tail` mode — 100k chars input with 50k limit produces first 25k + WARNING + last 25k, verify WARNING contains correct removed count
- coding-agent-loop.AC5.4: `tail` mode — 100k chars input with 50k limit keeps last 50k chars with WARNING prefix, verify WARNING contains correct removed count
- coding-agent-loop.AC5.5: Pathological 10MB single line — passes through char truncation cleanly, line truncation sees only 1 line (no split)
- coding-agent-loop.AC5.6: Default limits match spec values — verify each tool's default char limit and truncation mode. Verify overrides via config work.

Additional edge cases:
- Output shorter than limit → returned unchanged
- Empty output → returned unchanged
- Unknown tool name → use a reasonable fallback (e.g., 30k head_tail)
- Only char limit applies (no line limit configured) → skip line truncation

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All truncation tests pass.

**Commit:** `feat(agent): implement output truncation pipeline`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tool dispatch function

**Verifies:** coding-agent-loop.AC3.1, coding-agent-loop.AC3.2, coding-agent-loop.AC3.3, coding-agent-loop.AC3.4, coding-agent-loop.AC3.5

**Files:**
- Create: `packages/agent/src/tools/dispatch.ts`
- Test: `packages/agent/src/tools/dispatch.test.ts` (unit)

**Implementation:**

`packages/agent/src/tools/dispatch.ts`:

A `dispatchToolCalls` function that takes an array of tool calls, a ToolRegistry, an ExecutionEnvironment, and parallel execution flag, then returns tool results.

```typescript
import type { ToolRegistry, ExecutionEnvironment } from '../types/index.js';

export type PendingToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export type ToolCallResult = {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
};

export async function dispatchToolCalls(
  toolCalls: ReadonlyArray<PendingToolCall>,
  registry: ToolRegistry,
  env: ExecutionEnvironment,
  parallel: boolean,
): Promise<ReadonlyArray<ToolCallResult>> {
  // Implementation:
  // If parallel: use Promise.allSettled() to run all executors concurrently
  // If sequential: run one at a time in order
  //
  // For each tool call:
  // 1. Look up tool in registry — if not found, return error result (AC3.2)
  // 2. Parse/validate args — if invalid JSON, return error result (AC3.3)
  // 3. Call executor(args, env) — if throws, catch and return error result (AC3.4)
  // 4. Return success result with output
}
```

Error results use `isError: true` with a descriptive message. They are NOT exceptions — the LLM receives them as tool results and can recover.

**Testing:**

Tests must verify each AC:
- coding-agent-loop.AC3.1: Tool call dispatched through registry, executor receives correct args and env
- coding-agent-loop.AC3.2: Unknown tool name → returns `{ isError: true, output: "Unknown tool: ..." }`
- coding-agent-loop.AC3.3: Invalid args (executor throws due to missing required field) → returns error result
- coding-agent-loop.AC3.4: Executor throws an exception → caught, returned as `{ isError: true, output: "Tool error: ..." }`
- coding-agent-loop.AC3.5: With `parallel: true`, multiple tools run concurrently (verify with timing — two 50ms tools should complete in ~50ms, not ~100ms)

Test setup: Create mock tools in a test ToolRegistry — a simple echo tool, a tool that throws, a tool with required args.

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All dispatch tests pass.

**Commit:** `feat(agent): implement tool call dispatch`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-6) -->
<!-- START_TASK_3 -->
### Task 3: Shared tool executors — read-file, write-file, edit-file

**Verifies:** (supports AC3.1 — tool executors follow the (args, env) signature)

**Files:**
- Create: `packages/agent/src/tools/read-file.ts`
- Create: `packages/agent/src/tools/write-file.ts`
- Create: `packages/agent/src/tools/edit-file.ts`
- Test: `packages/agent/src/tools/read-file.test.ts` (unit)
- Test: `packages/agent/src/tools/write-file.test.ts` (unit)
- Test: `packages/agent/src/tools/edit-file.test.ts` (unit)

**Implementation:**

Each tool follows the `ToolExecutor` signature: `(args, env) => Promise<string>`.

**`read-file.ts`** — Executor and tool definition:
- Args: `{ file_path: string, offset?: number, limit?: number }`
- Delegates to `env.readFile(path, offset, limit)`
- Returns the file content with line numbers
- On error (file not found, etc.), returns error string (not throwing)

**`write-file.ts`** — Executor and tool definition:
- Args: `{ file_path: string, content: string }`
- Delegates to `env.writeFile(path, content)`
- Returns confirmation string (e.g., `"Wrote 42 bytes to path/to/file.ts"`)

**`edit-file.ts`** — Executor and tool definition (Anthropic/Claude Code style):
- Args: `{ file_path: string, old_string: string, new_string: string, replace_all?: boolean }`
- Reads file via `env.readFile()`, performs string replacement, writes back via `env.writeFile()`
- `old_string` must be unique in the file (unless `replace_all: true`)
- If `old_string` not found: return error describing the problem
- If `old_string` found multiple times and `replace_all` is false: return error asking for more context
- Returns diff-like confirmation showing what changed

Each tool exports both its executor function and a `RegisteredTool` factory that pairs the executor with a `ToolDefinition` (JSON Schema for the parameters).

**Testing:**

Tests use a mock `ExecutionEnvironment` (or test helper that wraps a temp directory).

Per tool:
- `read-file`: Reads existing file, handles offset/limit, handles missing file
- `write-file`: Writes content, creates parent dirs, returns confirmation
- `edit-file`: Replaces unique string, rejects non-unique match (unless replace_all), handles string not found, handles replace_all mode

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All file tool tests pass.

**Commit:** `feat(agent): implement read-file, write-file, edit-file tool executors`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Shared tool executors — shell, grep, glob

**Files:**
- Create: `packages/agent/src/tools/shell.ts`
- Create: `packages/agent/src/tools/grep.ts`
- Create: `packages/agent/src/tools/glob.ts`
- Test: `packages/agent/src/tools/shell.test.ts` (unit)
- Test: `packages/agent/src/tools/grep.test.ts` (unit)
- Test: `packages/agent/src/tools/glob.test.ts` (unit)

**Implementation:**

**`shell.ts`** — Shell command executor:
- Args: `{ command: string, timeout_ms?: number, working_dir?: string }`
- Delegates to `env.execCommand(command, timeout_ms, working_dir)`
- Formats result: combines stdout + stderr with exit code and duration
- If `timedOut`: adds timeout warning to output

**`grep.ts`** — Regex search executor:
- Args: `{ pattern: string, path?: string, case_sensitive?: boolean, max_results?: number, include?: string }`
- Delegates to `env.grep(pattern, path, options)`
- Returns grep output as string

**`glob.ts`** — File pattern matching executor:
- Args: `{ pattern: string, path?: string }`
- Delegates to `env.glob(pattern, path)`
- Returns matched paths as newline-separated string

Each exports both executor and `RegisteredTool` factory.

**Testing:**

Tests use mock `ExecutionEnvironment`:
- `shell`: Verify command result formatting, timeout handling, working directory pass-through
- `grep`: Verify pattern and options forwarded correctly
- `glob`: Verify pattern and path forwarded correctly, output formatting

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All command/search tool tests pass.

**Commit:** `feat(agent): implement shell, grep, glob tool executors`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: apply-patch v4a format parser

**Files:**
- Create: `packages/agent/src/tools/apply-patch.ts`
- Test: `packages/agent/src/tools/apply-patch.test.ts` (unit)

**Implementation:**

`packages/agent/src/tools/apply-patch.ts` — The most complex tool. Parses and applies the v4a patch format used by OpenAI's codex-rs.

**Grammar (from the v4a spec):**

```
*** Begin Patch
[one or more file operations]
*** End Patch
```

Three operation types:
1. **Add File**: `*** Add File: <path>` followed by lines prefixed with `+`
2. **Delete File**: `*** Delete File: <path>` (no content)
3. **Update File**: `*** Update File: <path>` optionally followed by `*** Move to: <new_path>`, then one or more hunks

**Hunk format:**
```
@@ [optional context header]
 context line (space prefix)
-removed line
+added line
 context line
```

**Implementation approach:**

1. **Parser**: Parse the patch text into a structured representation:
   ```typescript
   type PatchOperation =
     | { readonly kind: 'add'; readonly path: string; readonly content: string }
     | { readonly kind: 'delete'; readonly path: string }
     | { readonly kind: 'update'; readonly path: string; readonly moveTo: string | null; readonly hunks: ReadonlyArray<Hunk> };

   type Hunk = {
     readonly contextHeader: string | null;
     readonly lines: ReadonlyArray<HunkLine>;
   };

   type HunkLine =
     | { readonly kind: 'context'; readonly text: string }
     | { readonly kind: 'add'; readonly text: string }
     | { readonly kind: 'remove'; readonly text: string };
   ```

2. **Applier**: For each operation:
   - **Add**: Write file via `env.writeFile()`
   - **Delete**: Verify file exists via `env.fileExists()`, then delete via `env.deleteFile()`
   - **Update**: Read file, apply each hunk using context matching, write result

3. **Context matching algorithm** (for Update hunks):
   - Find the location in the file where context lines match
   - Strategy 1: Exact line match
   - Strategy 2: Whitespace-trimmed match (leading/trailing)
   - Strategy 3: Fuzzy match (skip to find best match location)
   - Once context is located, apply the `-` (remove) and `+` (add) lines

4. **Error handling**: Parse errors and match failures return descriptive error strings.

**Executor:**
- Args: `{ patch: string }`
- Parses patch, applies operations sequentially
- Returns summary of operations performed (e.g., "Applied 3 operations: Added src/new.ts, Updated src/main.ts (2 hunks), Deleted src/old.ts")

**Testing:**

This tool warrants thorough unit testing:

Parser tests:
- Parse Add File operation
- Parse Delete File operation
- Parse Update File with single hunk
- Parse Update File with multiple hunks
- Parse Update File with Move To
- Parse multi-file patch (mix of operations)
- Parse error: missing `*** Begin Patch` marker
- Parse error: missing `*** End Patch` marker
- Parse error: invalid line prefix in hunk

Context matching tests:
- Exact match succeeds
- Whitespace-trimmed match succeeds when exact fails
- Fuzzy match finds context at different position
- No match found → descriptive error

End-to-end tests (using mock env):
- Add new file
- Delete existing file
- Update file with single hunk
- Update file with multiple hunks
- Update + Move (rename)
- Multi-file patch with mix of operations

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All apply-patch tests pass.

**Commit:** `feat(agent): implement apply-patch v4a format parser`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Update tools barrel export

**Files:**
- Modify: `packages/agent/src/tools/index.ts`

**Implementation:**

Update the barrel export to re-export all tool modules:

```typescript
export * from './dispatch.js';
export * from './read-file.js';
export * from './write-file.js';
export * from './edit-file.js';
export * from './apply-patch.js';
export * from './shell.js';
export * from './grep.js';
export * from './glob.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

**Commit:** `chore(agent): update tools barrel export`

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
Expected: All tests pass (truncation + dispatch + all tool executors + apply-patch).

**Commit:** Not needed unless fixes are required.

<!-- END_TASK_7 -->
