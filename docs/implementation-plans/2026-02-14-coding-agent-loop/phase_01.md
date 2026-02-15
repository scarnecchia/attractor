# Coding Agent Loop Implementation Plan — Phase 1

**Goal:** Add missing `reasoningEffort` field and response accessor functions to `@attractor/llm`, scaffold the `@attractor/agent` package with build tooling.

**Architecture:** Two parallel workstreams — SDK fixes in the existing `packages/llm/` package, and new package scaffolding in `packages/agent/`. A root `package.json` is created to enable npm workspaces across both packages.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only, tsup 8.5, Vitest 4.0

**Scope:** 8 phases from original design (phase 1 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC8: SDK Fixes
- **coding-agent-loop.AC8.1 Success:** `reasoningEffort` field on LLMRequest accepted by all adapters
- **coding-agent-loop.AC8.2 Success:** Changing `reasoningEffort` mid-session takes effect on next LLM call
- **coding-agent-loop.AC8.3 Success:** `responseText()` extracts concatenated text from TEXT ContentParts
- **coding-agent-loop.AC8.4 Success:** `responseToolCalls()` extracts ToolCall[] from TOOL_CALL ContentParts; `responseReasoning()` extracts thinking text

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Root workspace package.json

**Files:**
- Create: `package.json` (repo root)

**Implementation:**

Create a root `package.json` that establishes npm workspaces for both packages. This enables cross-package dependencies and shared scripts.

```json
{
  "name": "attractor",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "typecheck": "npm run typecheck --workspaces",
    "clean": "npm run clean --workspaces"
  }
}
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor && cat package.json`
Expected: File contents match above.

**Commit:** `chore: add root workspace package.json`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Scaffold @attractor/agent package

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/tsup.config.ts`
- Create: `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/index.ts`

**Implementation:**

**`packages/agent/package.json`:**
```json
{
  "name": "@attractor/agent",
  "version": "0.0.1",
  "description": "Programmable coding agent loop — orchestrates LLMs with developer tools",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration --testTimeout 30000",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "peerDependencies": {
    "@attractor/llm": "0.0.1"
  },
  "devDependencies": {
    "@attractor/llm": "0.0.1",
    "@types/node": "^25.2.3",
    "tsup": "^8.5.1",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

**`packages/agent/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleDetection": "force"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Note: identical to `packages/llm/tsconfig.json` except `"lib"` omits `"DOM"` (agent package has no browser DOM dependency).

**`packages/agent/tsup.config.ts`:**
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
```

**`packages/agent/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

**`packages/agent/src/index.ts`:**
```typescript
// @attractor/agent — programmable coding agent loop
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor && npm install`
Expected: Installs without errors, symlinks `@attractor/llm` into agent's `node_modules`.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes (empty barrel).

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds, creates `dist/index.js`.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: Test runner completes (0 tests found is OK at this stage).

**Commit:** `chore: scaffold @attractor/agent package`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Add reasoningEffort to LLMRequest

**Verifies:** coding-agent-loop.AC8.1

**Files:**
- Modify: `packages/llm/src/types/request.ts:5-22`
- Test: `packages/llm/src/types/request.test.ts` (unit)

**Implementation:**

Add `reasoningEffort` as an optional field on `LLMRequest` after the existing `providerOptions` field. The type is a string literal union of `'low' | 'medium' | 'high'`.

In `packages/llm/src/types/request.ts`, add at line 21 (before closing `}`):

```typescript
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
```

The field is typed as optional because most models don't support reasoning effort, and the adapters silently skip it when the model doesn't support it.

**Testing:**

Tests must verify:
- coding-agent-loop.AC8.1: An `LLMRequest` object can include `reasoningEffort` with values `'low'`, `'medium'`, `'high'`, and `undefined` — all type-check correctly.

This is a type-level addition. The compiler verifies it. A simple compile-time assertion test confirms the type accepts the field.

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npx tsc --noEmit`
Expected: Typecheck passes.

**Commit:** `feat(llm): add reasoningEffort field to LLMRequest`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Thread reasoningEffort through all adapters

**Verifies:** coding-agent-loop.AC8.1, coding-agent-loop.AC8.2

**Files:**
- Modify: `packages/llm/src/providers/openai/request.ts:24-173` (add reasoning mapping)
- Modify: `packages/llm/src/providers/anthropic/request.ts:52-222` (add thinking budget mapping)
- Modify: `packages/llm/src/providers/gemini/request.ts:33-220` (add thinkingConfig mapping)
- Test: `packages/llm/src/providers/openai/openai.test.ts` (unit)
- Test: `packages/llm/src/providers/anthropic/request.test.ts` (unit)
- Test: `packages/llm/src/providers/gemini/gemini.test.ts` (unit)

**Implementation:**

Each adapter's `translateRequest()` function must map `reasoningEffort` to the provider-specific parameter format. When `reasoningEffort` is `undefined`, no reasoning-related parameters are added (existing behavior preserved).

**OpenAI** (`packages/llm/src/providers/openai/request.ts`):

After the streaming flag block (around line 164), before provider options, add:

```typescript
  // Reasoning effort
  if (request.reasoningEffort) {
    body['reasoning'] = { effort: request.reasoningEffort };
  }
```

OpenAI's Responses API accepts `reasoning.effort` with values `low`, `medium`, `high` — an exact match to our field values.

**Anthropic** (`packages/llm/src/providers/anthropic/request.ts`):

After the stop_sequences block (around line 184), before provider options, add:

```typescript
  // Reasoning effort → Anthropic thinking budget
  if (request.reasoningEffort) {
    const budgetMap: Record<string, number> = {
      low: 1024,
      medium: 4096,
      high: 16384,
    };
    const budget = budgetMap[request.reasoningEffort];
    if (budget !== undefined) {
      body['thinking'] = { type: 'enabled', budget_tokens: budget };
    }
  }
```

Anthropic's Messages API uses `thinking.budget_tokens` to control extended thinking. The budget values (1024/4096/16384) are reasonable defaults — consumers can override via `providerOptions` if needed.

**Gemini** (`packages/llm/src/providers/gemini/request.ts`):

After the generationConfig block (around line 203), before provider options, add:

```typescript
  // Reasoning effort → Gemini thinking config
  if (request.reasoningEffort) {
    const budgetMap: Record<string, number> = {
      low: 1024,
      medium: 4096,
      high: 16384,
    };
    const budget = budgetMap[request.reasoningEffort];
    if (budget !== undefined) {
      generationConfig['thinkingConfig'] = {
        thinkingBudget: budget,
      };
    }
  }
```

Note: This block must be placed BEFORE the `if (Object.keys(generationConfig).length > 0)` check so that `thinkingConfig` is included inside `generationConfig` when serialized.

**Testing:**

Tests must verify each AC:
- coding-agent-loop.AC8.1: Each adapter's `translateRequest()` produces the correct provider-specific reasoning parameters when `reasoningEffort` is `'low'`, `'medium'`, `'high'`.
- coding-agent-loop.AC8.1 (negative): When `reasoningEffort` is `undefined`, no reasoning-related parameters appear in the translated request body.
- coding-agent-loop.AC8.2: Two successive calls to `translateRequest()` with different `reasoningEffort` values produce different bodies — demonstrating that changing the value mid-session takes effect on the next call.

Test structure per adapter:
- `describe('reasoningEffort')` containing:
  - `it('maps low/medium/high to provider-specific format')`
  - `it('omits reasoning params when reasoningEffort is undefined')`
  - `it('changing reasoningEffort between calls produces different bodies')`

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npm test`
Expected: All existing tests pass plus new reasoning effort tests.

**Commit:** `feat(llm): thread reasoningEffort through all adapters`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Response accessor functions

**Verifies:** coding-agent-loop.AC8.3, coding-agent-loop.AC8.4

**Files:**
- Modify: `packages/llm/src/types/response.ts:1-68` (add accessor functions)
- Modify: `packages/llm/src/types/tool.ts` (verify ToolCall type is exported — needed for return type)
- Test: `packages/llm/src/types/response.test.ts` (unit)

**Implementation:**

Add three standalone functions to `packages/llm/src/types/response.ts`. These extract specific content from an `LLMResponse`'s `content` array by filtering on the `kind` discriminant.

Add at the end of `packages/llm/src/types/response.ts` (after the `LLMResponse` type definition):

```typescript
export function responseText(response: Readonly<LLMResponse>): string {
  return response.content
    .filter((part): part is TextData => part.kind === 'TEXT')
    .map((part) => part.text)
    .join('');
}

export type ExtractedToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
};

export function responseToolCalls(response: Readonly<LLMResponse>): ReadonlyArray<ExtractedToolCall> {
  return response.content
    .filter((part): part is ToolCallData => part.kind === 'TOOL_CALL')
    .map((part) => ({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: part.args,
    }));
}

export function responseReasoning(response: Readonly<LLMResponse>): string {
  return response.content
    .filter((part): part is ThinkingData => part.kind === 'THINKING')
    .map((part) => part.text)
    .join('');
}
```

The file needs to import `TextData`, `ToolCallData`, and `ThinkingData` from `./content.js`. Update the import at line 1 to:

```typescript
import type { ContentPart, TextData, ToolCallData, ThinkingData } from './content.js';
```

`ExtractedToolCall` is a new type (not reusing `ToolCall` from tool.ts) because `ToolCall` includes `execute?` function and other fields — the accessor should return a clean data-only projection. This matches the spec's requirement: "extracts ToolCall[] from TOOL_CALL ContentParts."

**Testing:**

Tests must verify each AC:
- coding-agent-loop.AC8.3: `responseText()` concatenates text from multiple TEXT ContentParts, returns empty string when no TEXT parts exist, ignores non-TEXT parts.
- coding-agent-loop.AC8.4: `responseToolCalls()` extracts `ExtractedToolCall[]` from TOOL_CALL ContentParts, returns empty array when none exist. `responseReasoning()` extracts concatenated thinking text from THINKING ContentParts, returns empty string when none exist. Both ignore irrelevant content kinds.

Test structure:
- `describe('responseText')` — mixed content (TEXT + TOOL_CALL + THINKING), text-only, no text, empty content array
- `describe('responseToolCalls')` — multiple tool calls, no tool calls, mixed content
- `describe('responseReasoning')` — single thinking block, multiple thinking blocks, no thinking, redacted thinking (should be excluded — only THINKING, not REDACTED_THINKING)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npm test`
Expected: All tests pass including new accessor tests.

**Commit:** `feat(llm): add response accessor functions (responseText, responseToolCalls, responseReasoning)`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update barrel exports

**Files:**
- Verify: `packages/llm/src/types/index.ts` (should already re-export `response.ts`)
- Verify: `packages/llm/src/index.ts` (should already re-export types)

**Implementation:**

Verify that the new `responseText`, `responseToolCalls`, `responseReasoning` functions and `ExtractedToolCall` type are accessible from the package entry point.

The barrel chain is:
1. Functions defined in `packages/llm/src/types/response.ts`
2. Re-exported by `packages/llm/src/types/index.ts` via `export * from './response.js'`
3. Re-exported by `packages/llm/src/index.ts` via `export * from './types/index.js'`

Since `response.ts` is already re-exported by the existing barrels (verified: `src/types/index.ts` line 4: `export * from './response.js'`), the new named exports automatically flow through. No changes needed.

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npm run build`
Expected: Build succeeds.

Verify exports appear in built output:
Run: `grep -c 'responseText\|responseToolCalls\|responseReasoning\|ExtractedToolCall' /Users/scarndp/dev/attractor/packages/llm/dist/index.js`
Expected: Count > 0 (functions are exported).

Run: `grep -c 'responseText\|responseToolCalls\|responseReasoning\|ExtractedToolCall' /Users/scarndp/dev/attractor/packages/llm/dist/index.d.ts`
Expected: Count > 0 (types are exported).

**Commit:** Not needed if no changes were required. If any barrel updates were needed, commit: `fix(llm): ensure response accessors are exported`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Create agent package directory structure

**Files:**
- Create: `packages/agent/src/types/index.ts`
- Create: `packages/agent/src/execution/index.ts`
- Create: `packages/agent/src/tools/index.ts`
- Create: `packages/agent/src/truncation/index.ts`
- Create: `packages/agent/src/profiles/index.ts`
- Create: `packages/agent/src/prompts/index.ts`
- Create: `packages/agent/src/session/index.ts`
- Create: `packages/agent/src/subagent/index.ts`

**Implementation:**

Create the directory structure specified in the design plan. Each `index.ts` is an empty barrel export file:

```typescript
// placeholder — populated in subsequent phases
```

Update `packages/agent/src/index.ts` to import from all sub-modules:

```typescript
export * from './types/index.js';
export * from './execution/index.js';
export * from './tools/index.js';
export * from './truncation/index.js';
export * from './profiles/index.js';
export * from './prompts/index.js';
export * from './session/index.js';
export * from './subagent/index.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

**Commit:** `chore(agent): create module directory structure`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Final verification — full workspace build and test

**Files:** None (verification only)

**Verification:**

Run: `cd /Users/scarndp/dev/attractor && npm run build --workspaces`
Expected: Both packages build without errors.

Run: `cd /Users/scarndp/dev/attractor && npm run typecheck --workspaces`
Expected: Both packages typecheck without errors.

Run: `cd /Users/scarndp/dev/attractor/packages/llm && npm test`
Expected: All 349+ existing unit tests pass plus new reasoningEffort and response accessor tests.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: Test runner completes (no test files yet — zero tests is expected).

**Commit:** Not needed unless fixes are required. If fixes are made, commit them with an appropriate message.

<!-- END_TASK_8 -->
