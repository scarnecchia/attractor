# @attractor/agent

> Programmable coding agent loop -- orchestrates LLMs with developer tools via provider-specific profiles.

Freshness: 2026-02-15

## Purpose

This package implements a coding agent loop that streams from an LLM, executes tool calls, and loops until the model stops requesting tools or a limit is hit. It abstracts provider differences (OpenAI/Anthropic/Gemini) behind ProviderProfile objects so consumers write provider-agnostic orchestration code.

## Architecture

8 module directories. Each depends only on modules above it in this list:

```
types        (SessionConfig, Turn, SessionEvent, ProviderProfile, ExecutionEnvironment, ToolRegistry)
execution    (LocalExecutionEnvironment -- file ops, process exec, grep, glob)
tools        (tool executors: read_file, write_file, edit_file, apply_patch, shell, grep, glob)
truncation   (two-stage char+line truncation pipeline for tool output)
profiles     (OpenAI/Anthropic/Gemini provider profiles with tool registries and prompts)
prompts      (5-layer system prompt builder, project doc discovery, git context)
session      (Session state machine, agentic loop, event emitter, steering, loop detection, context tracking)
subagent     (spawn_agent, send_input, wait, close_agent tools with depth limiting)
```

Package entry: `src/index.ts` re-exports all modules.

## Contracts

### Session (primary API surface)

`createSession(options: SessionOptions): Session`

```typescript
type Session = {
  submit(input: string): Promise<void>;   // Send user input, triggers agentic loop
  steer(message: string): void;           // Inject steering turn mid-loop
  followUp(message: string): void;        // Queue follow-up after current loop completes
  abort(): Promise<void>;                 // Graceful shutdown (idempotent)
  events(): AsyncIterable<SessionEvent>;  // Async iterator of all session events
  state(): SessionState;                  // Current state
  history(): ReadonlyArray<Turn>;         // Full turn history
};
```

State machine: `IDLE -> PROCESSING -> IDLE -> ... -> CLOSED`

- `submit()` while CLOSED throws
- Fatal errors (AuthenticationError, ContextLengthError, exhausted retries) transition to CLOSED
- `abort()` cancels LLM stream, kills child processes, closes subagents, emits SESSION_END

### SessionEvent Discriminated Union

Discriminant field: `kind`. 13 event kinds: `SESSION_START`, `SESSION_END`, `ASSISTANT_TEXT_START`, `ASSISTANT_TEXT_DELTA`, `ASSISTANT_TEXT_END`, `TOOL_CALL_START`, `TOOL_CALL_END`, `THINKING_DELTA`, `TURN_LIMIT`, `LOOP_DETECTION`, `CONTEXT_WARNING`, `ERROR`, `SUBAGENT_EVENT`.

### Turn Discriminated Union

Discriminant field: `kind`. Values: `user`, `assistant`, `tool_results`, `system`, `steering`.

### ExecutionEnvironment Interface

All file/process operations go through this interface (`src/types/environment.ts`). `LocalExecutionEnvironment` is the standard implementation using Node fs/child_process.

### ToolRegistry

Mutable container (intentional exception to immutability convention). `register()` / `unregister()` / `get()` / `definitions()` / `list()`. Session registers subagent tools post-construction.

### ProviderProfile

Bundles provider-specific behaviour: tool registry, system prompt builder, default model, parallel tool call support, project doc file names, default command timeout.

| Profile | Display Name | Default Model | Project Doc Files |
|---------|-------------|---------------|-------------------|
| openai | codex-rs | o4-mini | AGENTS.md, .codex/instructions.md |
| anthropic | Claude Code | claude-sonnet-4-5 | AGENTS.md, CLAUDE.md |
| gemini | gemini-cli | gemini-2.5-pro | AGENTS.md, GEMINI.md |

### Tool Dispatch

`dispatchToolCalls()` runs tools in parallel (`Promise.allSettled`) or sequential mode. Unknown tools, invalid args, and executor exceptions all produce error results (never throw).

### Truncation Pipeline

Two-stage: character truncation (head_tail or tail mode) then line truncation. Per-tool defaults in `DEFAULT_CHAR_LIMITS` and `DEFAULT_LINE_LIMITS`. TOOL_CALL_END events carry full untruncated output; only history sent to LLM is truncated.

## Dependencies

- **Peer**: `@attractor/llm` 0.0.1 (Client, StreamAccumulator, message helpers, error types)
- **Runtime**: `nanoid` (session IDs), `tinyglobby` (glob in LocalExecutionEnvironment)
- **Node built-ins**: `node:child_process`, `node:fs/promises`, `node:path`, `node:os`
- **Dev**: TypeScript ^5.7, tsup ^8.5, Vitest ^4.0

**NOTE**: `nanoid` and `tinyglobby` are imported at runtime but missing from `dependencies` in package.json (only in devDependencies implicitly via lockfile). This should be fixed before publish.

## Invariants

- All type fields use `readonly` -- types are immutable value objects (ToolRegistry is the documented exception)
- ESM-only (`"type": "module"`)
- Node >= 20.0.0
- Tool executor errors never propagate -- always caught and returned as error results to the LLM
- Session state transitions are one-directional: IDLE -> PROCESSING -> IDLE or CLOSED
- Context tracking uses 1 token ~ 4 chars heuristic, warns at 80% usage
- Loop detection checks patterns of length 1 (5+ repeats), 2 (3+ alternating pairs), 3 (2+ repeating triples)
- Subagent depth is bounded by `maxSubagentDepth` config (prevents infinite nesting)
- Steering and system turns are mapped to user messages in the LLM request (not separate roles)

## Testing

- Unit tests colocated: `src/**/*.test.ts` (475 tests)
- Integration tests: `tests/integration/` (parity-matrix, smoke)
- Run: `npm test` (unit), `npm run test:integration` (integration)
- Build: `npm run build` (tsup)
- Typecheck: `npm run typecheck`
