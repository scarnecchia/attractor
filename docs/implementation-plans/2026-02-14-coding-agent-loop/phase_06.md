# Coding Agent Loop Implementation Plan — Phase 6

**Goal:** Implement all three provider profiles (OpenAI, Anthropic, Gemini) with native tool definitions, system prompts, and custom tool registration.

**Architecture:** Each profile is a factory function returning a `ProviderProfile` object. Profiles wire shared tool executors (from Phase 3) to provider-specific `ToolDefinition` schemas, and provide a `buildSystemPrompt()` method producing provider-aligned base instructions. Custom tools can be registered on top via `toolRegistry.register()` with name collision override semantics.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only

**Scope:** 8 phases from original design (phase 6 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC2: Provider Profiles
- **coding-agent-loop.AC2.1 Success:** OpenAI profile provides codex-rs-aligned tools including `apply_patch` (v4a format)
- **coding-agent-loop.AC2.2 Success:** Anthropic profile provides Claude Code-aligned tools including `edit_file` (old_string/new_string)
- **coding-agent-loop.AC2.3 Success:** Gemini profile provides gemini-cli-aligned tools including `list_dir`
- **coding-agent-loop.AC2.4 Success:** Each profile produces a provider-specific system prompt covering identity, tool usage, and coding guidance
- **coding-agent-loop.AC2.5 Success:** Custom tools registered on top of any profile via `toolRegistry.register()`
- **coding-agent-loop.AC2.6 Success:** Tool name collisions resolved: custom registration overrides profile default

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Shared tool wiring helpers

**Files:**
- Create: `packages/agent/src/profiles/shared-tools.ts`

**Implementation:**

`packages/agent/src/profiles/shared-tools.ts`:

Provides helper functions that create `RegisteredTool` objects by pairing shared tool executors (from `packages/agent/src/tools/`) with a `ToolDefinition` schema. Each profile calls these helpers with provider-specific parameter schemas.

```typescript
import type { RegisteredTool, ToolDefinition, ToolExecutor } from '../types/index.js';

export type ToolSchemaOverrides = {
  readonly name?: string;
  readonly description?: string;
  readonly parameters?: Record<string, unknown>;
};

export function createRegisteredTool(
  definition: ToolDefinition,
  executor: ToolExecutor,
): RegisteredTool {
  return { definition, executor };
}
```

Also export helper functions to create standard tool definitions for each shared tool with default parameter schemas. Each profile then calls these with optional overrides to match native conventions:

```typescript
export function readFileDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'read_file',
    description: overrides?.description ?? 'Read the contents of a file.',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['file_path'],
    },
  };
}

// Similar functions for:
// - writeFileDefinition(overrides?)
// - editFileDefinition(overrides?) — Anthropic/Gemini use old_string/new_string
// - applyPatchDefinition(overrides?) — OpenAI-specific
// - shellDefinition(overrides?)
// - grepDefinition(overrides?)
// - globDefinition(overrides?)
// - listDirDefinition(overrides?) — Gemini-specific
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

**Commit:** `feat(agent): add shared tool wiring helpers`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: OpenAI profile — codex-rs-aligned

**Verifies:** coding-agent-loop.AC2.1, coding-agent-loop.AC2.4

**Files:**
- Create: `packages/agent/src/profiles/openai/tools.ts`
- Create: `packages/agent/src/profiles/openai/prompt.ts`
- Create: `packages/agent/src/profiles/openai/index.ts`
- Test: `packages/agent/src/profiles/openai/openai-profile.test.ts` (unit)

**Implementation:**

**`packages/agent/src/profiles/openai/tools.ts`** — Wires shared executors to codex-rs-aligned tool definitions:

```typescript
import type { RegisteredTool } from '../../types/index.js';

export function createOpenAITools(): ReadonlyArray<RegisteredTool> {
  // Creates RegisteredTool array with these tools:
  // 1. read_file — file_path (string), offset? (number), limit? (number)
  // 2. apply_patch — patch (string) — the v4a patch format content
  //    NOTE: replaces write_file and edit_file for edits; OpenAI models
  //    use apply_patch for all file modifications
  // 3. write_file — file_path (string), content (string) — for new files only
  // 4. shell — command (string), timeout_ms? (number, default 10000)
  //    NOTE: OpenAI default shell timeout is 10s (not 120s like Anthropic)
  // 5. grep — pattern (string), path (string), include? (string)
  // 6. glob — pattern (string), path? (string)
  //
  // Each tool uses the shared executor from packages/agent/src/tools/
  // The apply_patch tool uses the v4a parser from tools/apply-patch.ts
}
```

Key differences from other profiles:
- Uses `apply_patch` instead of `edit_file` for file modifications
- Shell default timeout: 10s (10000ms)
- File paths in patches are relative (enforced by the v4a parser)

**`packages/agent/src/profiles/openai/prompt.ts`** — System prompt base instructions:

```typescript
import type { SystemPromptContext } from '../../types/index.js';

export function buildOpenAISystemPrompt(context: SystemPromptContext): string {
  // Mirrors codex-rs topics:
  // 1. Identity: "You are a coding assistant..."
  // 2. apply_patch tool usage: patch format conventions, relative paths only,
  //    file operations (Add/Update/Delete), context lines for hunk matching
  // 3. AGENTS.md instructions: read and follow project docs
  // 4. Coding best practices: fix root causes, match existing patterns,
  //    validate via testing, prefer ripgrep for search
  // 5. Communication: concise preamble before tool calls (8-12 words)
  // 6. Planning: use structured plans for multi-step tasks
  //
  // Returns the base instruction string (Layer 1 of the 5-layer prompt)
}
```

**`packages/agent/src/profiles/openai/index.ts`** — Factory function:

```typescript
import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';

export type OpenAIProfileOptions = {
  readonly model?: string;
};

export function createOpenAIProfile(options?: OpenAIProfileOptions): ProviderProfile {
  const tools = createOpenAITools();
  const registry = createToolRegistry(tools);

  return {
    id: 'openai',
    displayName: 'OpenAI (codex-rs)',
    defaultModel: options?.model ?? 'o4-mini',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildOpenAISystemPrompt,
    projectDocFiles: ['AGENTS.md', '.codex/instructions.md'],
    defaultCommandTimeout: 10_000, // 10s — codex-rs default
  };
}
```

**Testing:**

Tests must verify:
- coding-agent-loop.AC2.1: Profile's tool registry includes `apply_patch` with correct parameter schema (patch: string). Does NOT include `edit_file`.
- coding-agent-loop.AC2.4: `buildSystemPrompt()` returns string containing identity, apply_patch guidance, and coding best practices.
- Tool definitions have correct names: `read_file`, `apply_patch`, `write_file`, `shell`, `grep`, `glob`
- `defaultCommandTimeout` is 10000
- `supportsParallelToolCalls` is true
- `projectDocFiles` includes `AGENTS.md` and `.codex/instructions.md`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All OpenAI profile tests pass.

**Commit:** `feat(agent): implement OpenAI provider profile`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Anthropic profile — Claude Code-aligned

**Verifies:** coding-agent-loop.AC2.2, coding-agent-loop.AC2.4

**Files:**
- Create: `packages/agent/src/profiles/anthropic/tools.ts`
- Create: `packages/agent/src/profiles/anthropic/prompt.ts`
- Create: `packages/agent/src/profiles/anthropic/index.ts`
- Test: `packages/agent/src/profiles/anthropic/anthropic-profile.test.ts` (unit)

**Implementation:**

**`packages/agent/src/profiles/anthropic/tools.ts`** — Wires shared executors to Claude Code-aligned tool definitions:

```typescript
import type { RegisteredTool } from '../../types/index.js';

export function createAnthropicTools(): ReadonlyArray<RegisteredTool> {
  // Creates RegisteredTool array with these tools:
  // 1. read_file — file_path (string, absolute), offset? (number), limit? (number)
  // 2. edit_file — file_path (string, absolute), old_string (string), new_string (string),
  //    replace_all? (boolean, default false)
  //    NOTE: old_string must be unique in file or edit fails (Claude Code convention)
  // 3. write_file — file_path (string, absolute), content (string)
  // 4. shell — command (string), timeout_ms? (number, default 120000)
  //    NOTE: Anthropic default shell timeout is 120s (2 minutes)
  // 5. grep — pattern (string), path (string), include? (string),
  //    case_sensitive? (boolean), context_lines? (number)
  // 6. glob — pattern (string), path? (string)
  //
  // Uses shared executors from packages/agent/src/tools/
  // edit_file uses the old_string/new_string executor from tools/edit-file.ts
}
```

Key differences from other profiles:
- Uses `edit_file` (not `apply_patch`) for file modifications
- Shell default timeout: 120s (120000ms) — Claude Code convention
- File paths must be absolute (Claude Code convention)

**`packages/agent/src/profiles/anthropic/prompt.ts`** — System prompt base instructions:

```typescript
import type { SystemPromptContext } from '../../types/index.js';

export function buildAnthropicSystemPrompt(context: SystemPromptContext): string {
  // Mirrors Claude Code topics:
  // 1. Identity: "You are an interactive coding assistant..."
  // 2. edit_file guidance: old_string must be unique, use more context to
  //    disambiguate, read file before editing, use replace_all for renames
  // 3. File operation preferences: prefer editing existing files over creating new,
  //    use Read tool before modifying, use Glob/Grep instead of shell find/grep
  // 4. Coding standards: fix root causes, maintain consistency, validate via testing,
  //    keep changes minimal and focused
  // 5. Communication: concise, use markdown, file_path:line_number references
  // 6. Security: defensive security only, refuse malicious requests
  // 7. CLAUDE.md / AGENTS.md: read and follow project instructions
  //
  // Returns the base instruction string (Layer 1 of the 5-layer prompt)
}
```

**`packages/agent/src/profiles/anthropic/index.ts`** — Factory function:

```typescript
import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';

export type AnthropicProfileOptions = {
  readonly model?: string;
};

export function createAnthropicProfile(options?: AnthropicProfileOptions): ProviderProfile {
  const tools = createAnthropicTools();
  const registry = createToolRegistry(tools);

  return {
    id: 'anthropic',
    displayName: 'Anthropic (Claude Code)',
    defaultModel: options?.model ?? 'claude-sonnet-4-5-20250929',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildAnthropicSystemPrompt,
    projectDocFiles: ['AGENTS.md', 'CLAUDE.md'],
    defaultCommandTimeout: 120_000, // 120s — Claude Code default
  };
}
```

**Testing:**

Tests must verify:
- coding-agent-loop.AC2.2: Profile's tool registry includes `edit_file` with correct parameter schema (file_path, old_string, new_string, replace_all?). Does NOT include `apply_patch`.
- coding-agent-loop.AC2.4: `buildSystemPrompt()` returns string containing identity, edit_file guidance (unique old_string, read before edit), and coding standards.
- Tool definitions have correct names: `read_file`, `edit_file`, `write_file`, `shell`, `grep`, `glob`
- `defaultCommandTimeout` is 120000
- `supportsParallelToolCalls` is true
- `projectDocFiles` includes `AGENTS.md` and `CLAUDE.md`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All Anthropic profile tests pass.

**Commit:** `feat(agent): implement Anthropic provider profile`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Gemini profile — gemini-cli-aligned

**Verifies:** coding-agent-loop.AC2.3, coding-agent-loop.AC2.4

**Files:**
- Create: `packages/agent/src/profiles/gemini/tools.ts`
- Create: `packages/agent/src/profiles/gemini/prompt.ts`
- Create: `packages/agent/src/profiles/gemini/index.ts`
- Test: `packages/agent/src/profiles/gemini/gemini-profile.test.ts` (unit)

**Implementation:**

**`packages/agent/src/profiles/gemini/tools.ts`** — Wires shared executors to gemini-cli-aligned tool definitions:

```typescript
import type { RegisteredTool } from '../../types/index.js';

export function createGeminiTools(): ReadonlyArray<RegisteredTool> {
  // Creates RegisteredTool array with these tools:
  // 1. read_file — path (string), offset? (number, 0-based), limit? (number)
  //    NOTE: Gemini uses "path" not "file_path"; offset is 0-based (not 1-based)
  // 2. edit_file — file_path (string), old_string (string), new_string (string),
  //    expected_replacements? (number, default 1)
  //    NOTE: Gemini uses expected_replacements count instead of replace_all boolean
  // 3. write_file — file_path (string), content (string)
  // 4. shell — command (string), timeout_ms? (number, default 10000)
  // 5. grep — pattern (string), path? (string), include? (string)
  // 6. glob — pattern (string), path? (string), case_sensitive? (boolean, default false)
  // 7. list_dir — path (string), ignore? (array of strings),
  //    respect_git_ignore? (boolean, default true)
  //    NOTE: Gemini-specific tool, not available on other profiles
  //
  // Uses shared executors from packages/agent/src/tools/ for:
  //   read_file, write_file, shell, grep, glob
  //
  // edit_file executor must handle expected_replacements by calling the shared
  //   edit executor N times or implementing a count-based replacement
  //
  // list_dir executor (Gemini-specific, defined inline here):
  //   1. Extract args: path (string, required), ignore (array of strings, optional),
  //      respect_git_ignore (boolean, default true)
  //   2. Call env.listDirectory(path) to get ReadonlyArray<DirEntry>
  //   3. Filter results: if ignore is provided, exclude entries whose names match
  //      any pattern in the ignore array (simple glob matching)
  //   4. If respect_git_ignore is true and a .gitignore file exists in path,
  //      additionally filter out entries matching .gitignore patterns
  //      (use simple string prefix matching; full .gitignore parsing not required)
  //   5. Format output as a directory listing string:
  //      one entry per line, directories suffixed with "/", files with size
  //   6. Apply truncation: line limit 500 (from SessionConfig defaults)
  //   Return the formatted listing string.
}
```

Key differences from other profiles:
- Has `list_dir` tool (unique to Gemini profile)
- Uses `edit_file` with `expected_replacements` count instead of `replace_all` boolean
- Shell default timeout: 10s (10000ms)
- `read_file` parameter name is `path` (not `file_path`)
- `glob` has `case_sensitive` parameter (default false)

**`packages/agent/src/profiles/gemini/prompt.ts`** — System prompt base instructions:

```typescript
import type { SystemPromptContext } from '../../types/index.js';

export function buildGeminiSystemPrompt(context: SystemPromptContext): string {
  // Mirrors gemini-cli topics:
  // 1. Identity: "You are a coding assistant..."
  // 2. Safety & approval: tool operations require confirmation for writes
  // 3. Tool protocols: auto-approved reads, confirmation for writes/network
  // 4. Code conventions: analyze surrounding code before modifying,
  //    check tests and config, never assume library availability
  // 5. GEMINI.md / AGENTS.md: read and follow project-specific instructions
  // 6. Communication: keep users informed, structured responses
  //
  // Returns the base instruction string (Layer 1 of the 5-layer prompt)
}
```

**`packages/agent/src/profiles/gemini/index.ts`** — Factory function:

```typescript
import type { ProviderProfile } from '../../types/index.js';
import { createToolRegistry } from '../../types/tool.js';

export type GeminiProfileOptions = {
  readonly model?: string;
};

export function createGeminiProfile(options?: GeminiProfileOptions): ProviderProfile {
  const tools = createGeminiTools();
  const registry = createToolRegistry(tools);

  return {
    id: 'gemini',
    displayName: 'Gemini (gemini-cli)',
    defaultModel: options?.model ?? 'gemini-2.5-pro',
    toolRegistry: registry,
    supportsParallelToolCalls: true,
    buildSystemPrompt: buildGeminiSystemPrompt,
    projectDocFiles: ['AGENTS.md', 'GEMINI.md'],
    defaultCommandTimeout: 10_000, // 10s — gemini-cli default
  };
}
```

**Testing:**

Tests must verify:
- coding-agent-loop.AC2.3: Profile's tool registry includes `list_dir` with correct parameter schema (path, ignore?, respect_git_ignore?). Also includes `edit_file` (not `apply_patch`).
- coding-agent-loop.AC2.4: `buildSystemPrompt()` returns string containing identity, safety/approval guidance, and code conventions.
- Tool definitions have correct names: `read_file`, `edit_file`, `write_file`, `shell`, `grep`, `glob`, `list_dir`
- `defaultCommandTimeout` is 10000
- `supportsParallelToolCalls` is true
- `projectDocFiles` includes `AGENTS.md` and `GEMINI.md`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All Gemini profile tests pass.

**Commit:** `feat(agent): implement Gemini provider profile`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Custom tool registration and collision override

**Verifies:** coding-agent-loop.AC2.5, coding-agent-loop.AC2.6

**Files:**
- Test: `packages/agent/src/profiles/custom-tools.test.ts` (unit)

**Implementation:**

This task tests the custom tool registration behaviour that is already built into `createToolRegistry()` from Phase 2. No new implementation code needed — just tests that verify the behaviour works end-to-end with real profiles.

The key contract: `toolRegistry.register()` should accept a `RegisteredTool` and add it to the registry. If a tool with the same name already exists (profile default), the new registration overrides it.

**Testing:**

Tests must verify:
- coding-agent-loop.AC2.5: Create an Anthropic profile, register a custom tool (e.g., `my_custom_tool`), verify `definitions()` includes both default tools AND the custom tool.
- coding-agent-loop.AC2.6: Create an OpenAI profile, register a custom tool with name `read_file` (same as profile default), verify the custom tool's definition overrides the profile default. Specifically:
  - Before override: `definitions()` contains profile's `read_file` definition
  - After `register()`: `definitions()` contains the custom `read_file` definition
  - `get('read_file')` returns the custom tool (not the profile default)
- Test on all three profiles (OpenAI, Anthropic, Gemini) to ensure consistent behaviour
- Verify `unregister()` can remove a custom tool and fall back to nothing (tool is gone, not restored to default)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All custom tool tests pass.

**Commit:** `test(agent): verify custom tool registration and collision override`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update profiles barrel export and final verification

**Files:**
- Create: `packages/agent/src/profiles/index.ts`

**Implementation:**

```typescript
export * from './shared-tools.js';
export * from './openai/index.js';
export * from './anthropic/index.js';
export * from './gemini/index.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass (previous phases + all three profiles + custom tool tests).

**Commit:** `chore(agent): update profiles barrel export`

<!-- END_TASK_6 -->
