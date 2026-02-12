# Unified LLM SDK Implementation Plan — Phase 1

**Goal:** Initialize the project structure, build tooling, and define all Layer 1 types.

**Architecture:** Single npm package `@attractor/llm` with 4-layer architecture (types → utils → client → api). ESM-only, strict TypeScript, native `fetch()`.

**Tech Stack:** TypeScript 5.7, tsup 8.5, Vitest 4.0, Node 20+, eventsource-parser 3.0, partial-json 0.1

**Scope:** 7 phases from original design (phases 1-7). This is Phase 1.

**Codebase verified:** 2026-02-10. Greenfield — no existing implementation code in worktree.

**Note:** Design specifies Node 18+ but Vitest 4.x requires Node 20+. Implementation targets Node 20+ to satisfy test framework requirements.

---

## Acceptance Criteria Coverage

This phase is infrastructure — verified operationally (install, build, test run).

**Verifies: None** — this is project scaffolding.

---

<!-- START_TASK_1 -->
### Task 1: Initialize package.json and install dependencies

**Files:**
- Create: `packages/llm/package.json`

**Step 1: Create the monorepo structure and package.json**

Create `packages/llm/package.json` with the following content:

```json
{
  "name": "@attractor/llm",
  "version": "0.0.1",
  "description": "Unified LLM SDK — provider-agnostic interface for OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./types": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/types/index.js"
    },
    "./client": {
      "types": "./dist/client/client.d.ts",
      "import": "./dist/client/client.js"
    },
    "./openai": {
      "types": "./dist/providers/openai/index.d.ts",
      "import": "./dist/providers/openai/index.js"
    },
    "./anthropic": {
      "types": "./dist/providers/anthropic/index.d.ts",
      "import": "./dist/providers/anthropic/index.js"
    },
    "./gemini": {
      "types": "./dist/providers/gemini/index.d.ts",
      "import": "./dist/providers/gemini/index.js"
    },
    "./openai-compatible": {
      "types": "./dist/providers/openai-compatible/index.d.ts",
      "import": "./dist/providers/openai-compatible/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "eventsource-parser": "^3.0.6",
    "partial-json": "^0.1.7"
  },
  "devDependencies": {
    "tsup": "^8.5.1",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Install dependencies**

Run from the `packages/llm` directory:

```bash
cd packages/llm && npm install
```

**Step 3: Verify installation**

```bash
ls node_modules/eventsource-parser node_modules/partial-json node_modules/tsup node_modules/typescript node_modules/vitest
```

Expected: All five directories exist.

**Step 4: Commit**

```bash
git add packages/llm/package.json packages/llm/package-lock.json
git commit -m "chore: initialize @attractor/llm package with dependencies"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: TypeScript and build configuration

**Files:**
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/tsup.config.ts`
- Create: `packages/llm/vitest.config.ts`

**Step 1: Create tsconfig.json**

Create `packages/llm/tsconfig.json`:

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
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleDetection": "force"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Create tsup.config.ts**

Create `packages/llm/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types/index.ts',
    'src/client/client.ts',
    'src/providers/openai/index.ts',
    'src/providers/anthropic/index.ts',
    'src/providers/gemini/index.ts',
    'src/providers/openai-compatible/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
```

**Step 3: Create vitest.config.ts**

Create `packages/llm/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
```

**Step 4: Verify typecheck runs (will pass since no source yet)**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors (no source files to check yet).

**Step 5: Commit**

```bash
git add packages/llm/tsconfig.json packages/llm/tsup.config.ts packages/llm/vitest.config.ts
git commit -m "chore: add TypeScript, tsup, and vitest configuration"
```
<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Core types — Role, ContentKind, ContentPart, ImageData, AudioData, DocumentData

**Files:**
- Create: `packages/llm/src/types/content.ts`

**Step 1: Create the content types file**

Create `packages/llm/src/types/content.ts` with:

- `Role` string literal union: `'system' | 'user' | 'assistant' | 'tool' | 'developer'`
- `ContentKind` string literal union: `'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'THINKING' | 'REDACTED_THINKING'`
- `ImageData` type with `kind: 'IMAGE'` discriminant plus `data: string | null`, `url: string | null`, `mediaType: string`
- `AudioData` type with `kind: 'AUDIO'` discriminant plus `data: string`, `mediaType: string`
- `DocumentData` type with `kind: 'DOCUMENT'` discriminant plus `data: string`, `mediaType: string`
- `ThinkingData` type with `kind: 'THINKING'` discriminant plus `text: string`, `signature: string | null`
- `RedactedThinkingData` type with `kind: 'REDACTED_THINKING'` discriminant plus `data: string`
- `ToolCallData` type with `kind: 'TOOL_CALL'` discriminant plus `toolCallId: string`, `toolName: string`, `args: Record<string, unknown>`
- `ToolResultData` type with `kind: 'TOOL_RESULT'` discriminant plus `toolCallId: string`, `content: string`, `isError: boolean`
- `TextData` type with `kind: 'TEXT'` discriminant plus `text: string`
- `ContentPart` discriminated union of all the above types

Each type should use `readonly` properties. Export all types as named exports.

**Step 2: Verify it compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/llm/src/types/content.ts
git commit -m "feat: add ContentPart discriminated union and content types"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Message type with static factories

**Files:**
- Create: `packages/llm/src/types/message.ts`

**Step 1: Create the Message type and factory class**

Create `packages/llm/src/types/message.ts` with:

- `Message` type containing: `readonly role: Role`, `readonly content: ReadonlyArray<ContentPart> | string`
- `MessageFactory` class (or namespace of functions) with static factory methods:
  - `system(text: string): Message` — creates `{ role: 'system', content: text }`
  - `user(content: string | ReadonlyArray<ContentPart>): Message` — creates user message
  - `assistant(content: string | ReadonlyArray<ContentPart>): Message` — creates assistant message
  - `tool(toolCallId: string, content: string, isError?: boolean): Message` — creates tool result message with a single `ToolResultData` content part
- Export `Message` type and `MessageFactory` (or individual factory functions: `systemMessage`, `userMessage`, `assistantMessage`, `toolMessage`)

Follow the design plan which says "Message (with static factories)". Prefer standalone factory functions over a class with static methods since this is functional code with no dependencies.

**Step 2: Verify it compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/llm/src/types/message.ts
git commit -m "feat: add Message type with factory functions"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Request, Response, Usage, and supporting types

**Files:**
- Create: `packages/llm/src/types/request.ts`
- Create: `packages/llm/src/types/response.ts`
- Create: `packages/llm/src/types/tool.ts`
- Create: `packages/llm/src/types/config.ts`

**Step 1: Create tool types**

Create `packages/llm/src/types/tool.ts` with:

- `Tool` type: `{ readonly name: string; readonly description: string; readonly parameters: Record<string, unknown>; readonly execute?: (args: Record<string, unknown>) => Promise<string>; }` — when `execute` is present, it's an "active" tool; when absent, it's "passive"
- `ToolCall` type: `{ readonly toolCallId: string; readonly toolName: string; readonly args: Record<string, unknown>; }`
- `ToolResult` type: `{ readonly toolCallId: string; readonly content: string; readonly isError: boolean; }`
- `ToolChoice` discriminated union:
  - `{ readonly mode: 'auto' }`
  - `{ readonly mode: 'none' }`
  - `{ readonly mode: 'required' }`
  - `{ readonly mode: 'named'; readonly toolName: string; }`

**Step 2: Create config types**

Create `packages/llm/src/types/config.ts` with:

- `TimeoutConfig` type: `{ readonly connectMs?: number; readonly requestMs?: number; readonly streamReadMs?: number; }`
- `RetryPolicy` type: `{ readonly maxRetries: number; readonly initialDelayMs: number; readonly maxDelayMs: number; readonly backoffMultiplier: number; readonly retryableStatusCodes: ReadonlyArray<number>; }`
- `ResponseFormat` type: `{ readonly type: 'text' | 'json_object' | 'json_schema'; readonly schema?: Record<string, unknown>; readonly name?: string; }`

**Step 3: Create Request type**

Create `packages/llm/src/types/request.ts` with:

- `Request` type containing all fields from the spec:
  - `readonly model: string`
  - `readonly provider?: string`
  - `readonly messages?: ReadonlyArray<Message>`
  - `readonly prompt?: string`
  - `readonly system?: string`
  - `readonly tools?: ReadonlyArray<Tool>`
  - `readonly toolChoice?: ToolChoice`
  - `readonly maxTokens?: number`
  - `readonly temperature?: number`
  - `readonly topP?: number`
  - `readonly stopSequences?: ReadonlyArray<string>`
  - `readonly responseFormat?: ResponseFormat`
  - `readonly timeout?: TimeoutConfig`
  - `readonly signal?: AbortSignal`
  - `readonly maxToolRounds?: number`
  - `readonly providerOptions?: Record<string, Record<string, unknown>>`

**Step 4: Create Response and Usage types**

Create `packages/llm/src/types/response.ts` with:

- `FinishReason` string literal union: `'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'`
- `Usage` type:
  - `readonly inputTokens: number`
  - `readonly outputTokens: number`
  - `readonly totalTokens: number`
  - `readonly reasoningTokens: number`
  - `readonly cacheReadTokens: number`
  - `readonly cacheWriteTokens: number`
- `usageAdd` function: `(a: Usage, b: Usage) => Usage` — adds each field
- `emptyUsage` function: `() => Usage` — returns a Usage with all fields set to 0
- `RateLimitInfo` type: `{ readonly limitRequests?: number; readonly limitTokens?: number; readonly remainingRequests?: number; readonly remainingTokens?: number; readonly resetRequests?: string; readonly resetTokens?: string; }`
- `Warning` type: `{ readonly type: string; readonly message: string; }`
- `StepResult` type: `{ readonly response: Response; readonly toolCalls: ReadonlyArray<ToolCall>; readonly toolResults: ReadonlyArray<ToolResult>; readonly usage: Usage; }`
- `Response` type:
  - `readonly id: string`
  - `readonly model: string`
  - `readonly content: ReadonlyArray<ContentPart>`
  - `readonly finishReason: FinishReason`
  - `readonly usage: Usage`
  - `readonly rateLimitInfo: RateLimitInfo | null`
  - `readonly warnings: ReadonlyArray<Warning>`
  - `readonly steps: ReadonlyArray<StepResult>`
  - `readonly providerMetadata: Record<string, unknown>`

**Step 5: Verify it all compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 6: Commit**

```bash
git add packages/llm/src/types/request.ts packages/llm/src/types/response.ts packages/llm/src/types/tool.ts packages/llm/src/types/config.ts
git commit -m "feat: add Request, Response, Usage, Tool, and config types"
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 6-7) -->
<!-- START_TASK_6 -->
### Task 6: StreamEvent types

**Files:**
- Create: `packages/llm/src/types/stream.ts`

**Step 1: Create stream event types**

Create `packages/llm/src/types/stream.ts` with:

- `StreamEventType` string literal union: `'STREAM_START' | 'TEXT_DELTA' | 'TOOL_CALL_START' | 'TOOL_CALL_DELTA' | 'TOOL_CALL_END' | 'THINKING_DELTA' | 'STEP_FINISH' | 'FINISH'`
- Discriminated union `StreamEvent` with a `type` discriminant:
  - `StreamStart`: `{ readonly type: 'STREAM_START'; readonly id: string; readonly model: string; }`
  - `TextDelta`: `{ readonly type: 'TEXT_DELTA'; readonly text: string; }`
  - `ToolCallStart`: `{ readonly type: 'TOOL_CALL_START'; readonly toolCallId: string; readonly toolName: string; }`
  - `ToolCallDelta`: `{ readonly type: 'TOOL_CALL_DELTA'; readonly toolCallId: string; readonly argsDelta: string; }`
  - `ToolCallEnd`: `{ readonly type: 'TOOL_CALL_END'; readonly toolCallId: string; }`
  - `ThinkingDelta`: `{ readonly type: 'THINKING_DELTA'; readonly text: string; }`
  - `StepFinish`: `{ readonly type: 'STEP_FINISH'; readonly finishReason: FinishReason; readonly usage: Usage; }`
  - `Finish`: `{ readonly type: 'FINISH'; readonly finishReason: FinishReason; readonly usage: Usage; }`

**Step 2: Verify it compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/llm/src/types/stream.ts
git commit -m "feat: add StreamEvent discriminated union types"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Error class hierarchy

**Files:**
- Create: `packages/llm/src/types/error.ts`

**Step 1: Create the error class hierarchy**

Create `packages/llm/src/types/error.ts` with the following class hierarchy:

```
SDKError (extends Error)
├── ConfigurationError
├── ValidationError
├── AbortError
├── RequestTimeoutError
├── NoObjectGeneratedError
├── NetworkError
├── StreamError
├── InvalidToolCallError
└── ProviderError
    ├── AuthenticationError (401, retryable=false)
    ├── AccessDeniedError (403, retryable=false)
    ├── NotFoundError (404, retryable=false)
    ├── InvalidRequestError (400/422, retryable=false)
    ├── ContextLengthError (413, retryable=false)
    ├── RateLimitError (429, retryable=true)
    ├── QuotaExceededError (retryable=false)
    ├── ContentFilterError (retryable=false)
    └── ServerError (500+, retryable=true)
```

`SDKError` extends `Error` with:
- `readonly name: string` (set to class name)
- `readonly cause?: Error` (optional root cause for error chaining)

`ProviderError` extends `SDKError` with:
- `readonly statusCode: number`
- `readonly retryable: boolean`
- `readonly retryAfter: number | null`
- `readonly provider: string`
- `readonly errorCode: string | null` (provider-specific error code from response body, e.g. `'invalid_api_key'`)
- `readonly raw: unknown`

Each `ProviderError` subclass sets appropriate defaults:
- `AuthenticationError`: `retryable = false`
- `AccessDeniedError`: `retryable = false`
- `NotFoundError`: `retryable = false`
- `InvalidRequestError`: `retryable = false`
- `ContextLengthError`: `retryable = false`
- `RateLimitError`: `retryable = true`
- `QuotaExceededError`: `retryable = false`
- `ContentFilterError`: `retryable = false`
- `ServerError`: `retryable = true`

`NoObjectGeneratedError` extends `SDKError` with:
- `readonly raw: unknown` (the raw response that failed parsing)

All classes should call `super()` and set `this.name` to the class name for proper error identification.

**Step 2: Verify it compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/llm/src/types/error.ts
git commit -m "feat: add SDKError hierarchy with ProviderError subclasses"
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_8 -->
### Task 8: ProviderAdapter interface and Middleware type

**Files:**
- Create: `packages/llm/src/types/provider.ts`
- Create: `packages/llm/src/types/middleware.ts`

**Step 1: Create the ProviderAdapter interface**

Create `packages/llm/src/types/provider.ts` with:

```typescript
interface ProviderAdapter {
  readonly name: string;
  complete(request: Request): Promise<Response>;
  stream(request: Request): AsyncIterable<StreamEvent>;
  close?(): Promise<void>;
  initialize?(): Promise<void>;
  supportsToolChoice?(mode: string): boolean;
}
```

This is one of the few cases where `interface` is correct — it defines a contract that adapter classes implement.

Import `Request` from `./request.ts`, `Response` from `./response.ts`, `StreamEvent` from `./stream.ts`.

**Step 2: Create the Middleware type**

Create `packages/llm/src/types/middleware.ts` with:

```typescript
type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response> | AsyncIterable<StreamEvent>,
) => Promise<Response> | AsyncIterable<StreamEvent>;
```

**Step 3: Verify it compiles**

```bash
cd packages/llm && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add packages/llm/src/types/provider.ts packages/llm/src/types/middleware.ts
git commit -m "feat: add ProviderAdapter interface and Middleware type"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Types barrel export and build verification

**Files:**
- Create: `packages/llm/src/types/index.ts`
- Create: `packages/llm/src/index.ts`

**Step 1: Create types barrel export**

Create `packages/llm/src/types/index.ts` that re-exports everything from:
- `./content.ts`
- `./message.ts`
- `./request.ts`
- `./response.ts`
- `./tool.ts`
- `./config.ts`
- `./stream.ts`
- `./error.ts`
- `./provider.ts`
- `./middleware.ts`

Use `export * from './content.js';` pattern (with `.js` extension for NodeNext module resolution).

**Step 2: Create root barrel export**

Create `packages/llm/src/index.ts` that re-exports from types:
```typescript
export * from './types/index.js';
```

This is a placeholder — later phases will add api/, client/, and provider exports here.

**Step 3: Verify build**

```bash
cd packages/llm && npm run build
```

Expected: `dist/` directory created with `.js` and `.d.ts` files for all entries. No errors.

**Step 4: Verify typecheck**

```bash
cd packages/llm && npm run typecheck
```

Expected: No errors.

**Step 5: Verify test runner starts (no tests yet)**

```bash
cd packages/llm && npm test
```

Expected: Vitest runs and reports 0 tests (or "no test files found"). Should exit without error.

**Step 6: Commit**

```bash
git add packages/llm/src/types/index.ts packages/llm/src/index.ts
git commit -m "feat: add barrel exports, verify build and test runner"
```

Note: Do NOT commit `dist/` — it should be in `.gitignore`. Only commit source files.
<!-- END_TASK_9 -->
