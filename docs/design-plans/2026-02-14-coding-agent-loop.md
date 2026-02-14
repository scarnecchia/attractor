# Coding Agent Loop Design

## Summary

`@attractor/agent` is a programmable agentic loop library that orchestrates coding tasks by pairing large language models with developer tools. Unlike CLI-based coding agents (Claude Code, codex-rs, gemini-cli), this is a library designed for programmatic control: a host application creates a `Session`, submits natural language input, and consumes a typed event stream as the agent thinks, calls tools (reading files, editing code, running commands), and produces output. The library provides three provider-aligned profiles (OpenAI/codex-rs, Anthropic/Claude Code, Gemini/gemini-cli), each with tool definitions and system prompts matching the native agent conventions those models were trained on.

The implementation follows a layered architecture: types define pure data structures (session state, turns, events, tools), `ExecutionEnvironment` abstracts all file and process operations behind an interface (with `LocalExecutionEnvironment` as the required default), shared tool implementations (read, write, edit, patch, shell, grep, glob) are wired to provider-specific schemas by each profile, and the core `Session` class orchestrates the agentic loop — streaming LLM responses via `@attractor/llm`, executing tools, truncating output, injecting steering, detecting loops, and managing subagents. The library adds missing SDK features (`reasoningEffort` field, response accessors) and implements comprehensive error handling, output truncation, system prompt construction with project doc discovery, and real-time event delivery for all agent actions.

## Definition of Done

1. **New `@attractor/agent` package** implementing the full coding-agent-loop-spec.md — Session, agentic loop, provider-aligned toolsets, ExecutionEnvironment, tool output truncation, event system, steering/follow-up, subagents, and system prompt construction with project doc discovery.

2. **SDK fixes in `@attractor/llm`** — `reasoning_effort` field added to LLMRequest and threaded through all adapters; response convenience accessors added (text extraction, tool call extraction, reasoning extraction from ContentPart arrays).

3. **Three provider profiles** (OpenAI/codex-rs, Anthropic/Claude Code, Gemini/gemini-cli) each with their native tool definitions, single comprehensive system prompt, and correct tool formats (apply_patch for OpenAI, edit_file old_string/new_string for Anthropic, gemini-cli conventions for Gemini).

4. **LocalExecutionEnvironment** as the required default implementation, with the ExecutionEnvironment interface extensible by consumers for Docker/K8s/SSH/WASM.

5. **Comprehensive test coverage** — unit tests for all components, integration smoke tests against the Anthropic provider with a real API key, cross-provider parity matrix (unit-tested for OpenAI/Gemini, integration-tested for Anthropic).

6. **All acceptance criteria** from spec Section 9 (Definition of Done) checked off — core loop (9.1), provider profiles (9.2), tool execution (9.3), execution environment (9.4), truncation (9.5), steering (9.6), reasoning effort (9.7), system prompts (9.8), subagents (9.9), event system (9.10), error handling (9.11).

## Acceptance Criteria

### coding-agent-loop.AC1: Core Agentic Loop
- **coding-agent-loop.AC1.1 Success:** Session created with ProviderProfile, ExecutionEnvironment, and Client; transitions to IDLE
- **coding-agent-loop.AC1.2 Success:** `process_input()` runs the loop: LLM stream → tool execution → loop until natural completion (text-only response)
- **coding-agent-loop.AC1.3 Success:** Natural completion: model responds with no tool calls, loop exits, session returns to IDLE
- **coding-agent-loop.AC1.4 Success:** Multiple sequential inputs work: submit → complete → submit again
- **coding-agent-loop.AC1.5 Failure:** `max_tool_rounds_per_input` reached → loop stops, emits TURN_LIMIT
- **coding-agent-loop.AC1.6 Failure:** `max_turns` across session reached → loop stops, emits TURN_LIMIT
- **coding-agent-loop.AC1.7 Failure:** Abort signal → cancels LLM stream, kills processes, session transitions to CLOSED
- **coding-agent-loop.AC1.8 Success:** Loop detection: repeating tool call pattern (window of 10) triggers SteeringTurn warning and LOOP_DETECTION event

### coding-agent-loop.AC2: Provider Profiles
- **coding-agent-loop.AC2.1 Success:** OpenAI profile provides codex-rs-aligned tools including `apply_patch` (v4a format)
- **coding-agent-loop.AC2.2 Success:** Anthropic profile provides Claude Code-aligned tools including `edit_file` (old_string/new_string)
- **coding-agent-loop.AC2.3 Success:** Gemini profile provides gemini-cli-aligned tools including `list_dir`
- **coding-agent-loop.AC2.4 Success:** Each profile produces a provider-specific system prompt covering identity, tool usage, and coding guidance
- **coding-agent-loop.AC2.5 Success:** Custom tools registered on top of any profile via `toolRegistry.register()`
- **coding-agent-loop.AC2.6 Success:** Tool name collisions resolved: custom registration overrides profile default

### coding-agent-loop.AC3: Tool Execution
- **coding-agent-loop.AC3.1 Success:** Tool calls dispatched through ToolRegistry, executor receives (args, executionEnv)
- **coding-agent-loop.AC3.2 Failure:** Unknown tool name → error result returned to LLM (is_error: true), not an exception
- **coding-agent-loop.AC3.3 Failure:** Invalid JSON arguments → validation error result returned to LLM
- **coding-agent-loop.AC3.4 Failure:** Tool execution throws → caught, returned as error result
- **coding-agent-loop.AC3.5 Success:** Parallel tool execution works when profile's `supportsParallelToolCalls` is true (Promise.allSettled)

### coding-agent-loop.AC4: Execution Environment
- **coding-agent-loop.AC4.1 Success:** `LocalExecutionEnvironment` reads files with line numbers, respects offset/limit
- **coding-agent-loop.AC4.2 Success:** `LocalExecutionEnvironment` writes files, creates parent directories
- **coding-agent-loop.AC4.3 Success:** Command execution spawns in process group, captures stdout/stderr, records duration
- **coding-agent-loop.AC4.4 Success:** Command timeout default is 10s; overridable per-call via `timeout_ms`
- **coding-agent-loop.AC4.5 Failure:** Timed-out command: process group receives SIGTERM, then SIGKILL after 2s; timeout message in output
- **coding-agent-loop.AC4.6 Success:** Env var filtering excludes `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL` by default; always includes PATH, HOME, etc.

### coding-agent-loop.AC5: Tool Output Truncation
- **coding-agent-loop.AC5.1 Success:** Character-based truncation runs FIRST on all tool outputs
- **coding-agent-loop.AC5.2 Success:** Line-based truncation runs SECOND where configured (shell: 256, grep: 200, glob: 500)
- **coding-agent-loop.AC5.3 Success:** head_tail mode keeps first half + last half of chars with WARNING marker
- **coding-agent-loop.AC5.4 Success:** tail mode drops beginning, keeps end with WARNING marker
- **coding-agent-loop.AC5.5 Edge:** Pathological input (10MB single line) handled by character truncation before line truncation sees it
- **coding-agent-loop.AC5.6 Success:** Default character limits match spec (read_file: 50k, shell: 30k, grep: 20k, etc.); all overridable via SessionConfig

### coding-agent-loop.AC6: Steering
- **coding-agent-loop.AC6.1 Success:** `steer()` queues message, injected after current tool round as SteeringTurn
- **coding-agent-loop.AC6.2 Success:** `followUp()` queues message, processed after current input completes (triggers new process_input cycle)
- **coding-agent-loop.AC6.3 Success:** SteeringTurns converted to user-role messages for the LLM
- **coding-agent-loop.AC6.4 Success:** Steering drained before first LLM call and after each tool round

### coding-agent-loop.AC7: Subagents
- **coding-agent-loop.AC7.1 Success:** `spawn_agent` creates child Session with independent history and shared ExecutionEnvironment
- **coding-agent-loop.AC7.2 Success:** Subagent uses parent's ProviderProfile (or overridden model)
- **coding-agent-loop.AC7.3 Success:** `send_input` queues a message to child; `wait` blocks until child completes
- **coding-agent-loop.AC7.4 Success:** `close_agent` aborts child session
- **coding-agent-loop.AC7.5 Failure:** Depth limiting: child cannot spawn sub-children (maxSubagentDepth=1 default)
- **coding-agent-loop.AC7.6 Success:** Subagent results returned to parent as tool results (output, success, turnsUsed)

### coding-agent-loop.AC8: SDK Fixes
- **coding-agent-loop.AC8.1 Success:** `reasoningEffort` field on LLMRequest accepted by all adapters
- **coding-agent-loop.AC8.2 Success:** Changing `reasoningEffort` mid-session takes effect on next LLM call
- **coding-agent-loop.AC8.3 Success:** `responseText()` extracts concatenated text from TEXT ContentParts
- **coding-agent-loop.AC8.4 Success:** `responseToolCalls()` extracts ToolCall[] from TOOL_CALL ContentParts; `responseReasoning()` extracts thinking text

### coding-agent-loop.AC9: System Prompts
- **coding-agent-loop.AC9.1 Success:** System prompt includes provider-specific base instructions
- **coding-agent-loop.AC9.2 Success:** System prompt includes environment context (platform, git, working dir, date, model info)
- **coding-agent-loop.AC9.3 Success:** Project docs (AGENTS.md + provider-specific files) discovered from git root to working dir
- **coding-agent-loop.AC9.4 Success:** Only relevant project files loaded (Anthropic loads CLAUDE.md, not GEMINI.md); AGENTS.md always loaded
- **coding-agent-loop.AC9.5 Edge:** Project docs exceeding 32KB budget truncated with marker
- **coding-agent-loop.AC9.6 Success:** User instruction override appended last (highest priority)

### coding-agent-loop.AC10: Event System
- **coding-agent-loop.AC10.1 Success:** All 13 EventKind values emitted at correct times during session lifecycle
- **coding-agent-loop.AC10.2 Success:** Events delivered via `AsyncIterable<SessionEvent>` (consumed with `for await`)
- **coding-agent-loop.AC10.3 Success:** `TOOL_CALL_END` carries full untruncated output
- **coding-agent-loop.AC10.4 Success:** `SESSION_START` and `SESSION_END` bracket the session

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

## Glossary

- **Agentic loop**: The repeating cycle of calling an LLM, executing tool calls from its response, returning results, and looping until the model produces a text-only response (natural completion) or a limit is hit.
- **Provider profile**: A bundle of model identity, tool registry, system prompt builder, and capability flags aligned to a specific LLM provider's native coding agent (codex-rs for OpenAI, Claude Code for Anthropic, gemini-cli for Gemini).
- **Session**: The central orchestrator holding conversation state (history as `Turn[]`), managing the event stream, dispatching tool calls, and exposing the control surface (`submit`, `steer`, `followUp`, `abort`).
- **Turn**: A single exchange in the conversation history. Types include `UserTurn`, `AssistantTurn`, `ToolResultsTurn`, `SystemTurn`, and `SteeringTurn`.
- **ExecutionEnvironment**: Interface abstracting all file and process operations. `LocalExecutionEnvironment` is the required default; consumers can implement Docker, Kubernetes, SSH, or WASM variants.
- **Tool truncation**: Two-stage pipeline (character-based first, line-based second) that reduces tool output for the LLM while delivering full untruncated output via events. Modes: `head_tail` (keep beginning + end) and `tail` (keep end only).
- **Steering**: Runtime injection of messages between tool rounds to redirect the agent mid-task. `steer()` injects after the current tool round; `followUp()` queues input processed after the current task completes.
- **Subagent**: A child `Session` with independent conversation history but sharing the parent's `ExecutionEnvironment`. Used for parallel work or subtask delegation. Depth limited to 1 level.
- **Natural completion**: When the LLM responds with only text (no tool calls), signaling the task is complete.
- **apply_patch**: OpenAI-specific tool using the v4a patch format from codex-rs. Supports Add/Update/Delete File operations with context-based hunk matching and fuzzy fallback.
- **v4a patch format**: Text-based diff format with `*** Begin Patch` / `*** End Patch` markers, file operations, and hunks with context lines for position matching.
- **Loop detection**: Monitoring tool call signatures across a sliding window (default: 10). If a repeating pattern (length 1, 2, or 3) is detected, a warning is injected.
- **StreamEvent**: Event type from `@attractor/llm` SDK delivered during `Client.stream()`. The agent loop maps these to agent-level `SessionEvent`s.
- **SessionEvent**: Typed event emitted by the agent (13 variants). Delivered via `AsyncIterable` for real-time consumption by the host application.
- **ContentPart**: Discriminated union from the SDK representing pieces of an LLM response (`TEXT`, `TOOL_CALL`, `THINKING`). Extracted via new SDK accessor functions.
- **Reasoning effort**: Parameter controlling extended thinking time for models supporting chain-of-thought reasoning. Maps to provider-specific mechanisms (OpenAI's `reasoning.effort`, Anthropic's thinking budget, Gemini's `thinkingConfig`).
- **Project docs**: Markdown instruction files (`AGENTS.md`, `CLAUDE.md`, `.codex/instructions.md`, `GEMINI.md`) discovered from git root to working directory and included in the system prompt.
- **ripgrep**: Fast grep alternative (`rg` binary) used by `LocalExecutionEnvironment.grep()` with fallback to Node regex if not installed.
- **Process group**: Unix concept for grouping a parent process and its children. Used for timeout enforcement: SIGTERM to group, SIGKILL after 2s grace period.

## Architecture

### Overview

`@attractor/agent` is a programmable agentic loop library. A host application creates a `Session`, submits natural language input, and consumes a typed event stream as the agent thinks, calls tools, and produces output. The agent uses `Client.stream()` from `@attractor/llm` for all LLM communication, implementing its own turn loop to interleave tool execution with output truncation, steering injection, event emission, and loop detection.

The package follows the same layered module pattern as `@attractor/llm`:

```
packages/agent/
  src/
    types/              — Pure data types (readonly, no logic)
      session.ts        — SessionConfig, SessionState, SessionEvent, EventKind
      turn.ts           — UserTurn, AssistantTurn, ToolResultsTurn, SystemTurn, SteeringTurn (discriminated union)
      profile.ts        — ProviderProfile interface, capability flags
      environment.ts    — ExecutionEnvironment interface, ExecResult, DirEntry
      tool.ts           — RegisteredTool, ToolDefinition, ToolRegistry
      index.ts
    execution/          — ExecutionEnvironment implementations
      local.ts          — LocalExecutionEnvironment (required default)
      index.ts
    tools/              — Shared tool implementations
      read-file.ts      — Read file with line numbers
      write-file.ts     — Write file, create parents
      edit-file.ts      — old_string/new_string exact match replacement
      apply-patch.ts    — v4a patch format parser (OpenAI-specific)
      shell.ts          — Shell command execution with timeout
      grep.ts           — Regex search across files
      glob.ts           — File pattern matching
      index.ts
    truncation/         — Output truncation pipeline
      truncate.ts       — Character-based and line-based truncation
      index.ts
    profiles/           — Provider-aligned profiles
      openai/           — codex-rs-aligned profile, system prompt, tool wiring
      anthropic/        — Claude Code-aligned profile, system prompt, tool wiring
      gemini/           — gemini-cli-aligned profile, system prompt, tool wiring
      index.ts
    prompts/            — System prompt construction
      builder.ts        — Layered prompt assembly (5 layers)
      discovery.ts      — Project doc discovery (AGENTS.md, CLAUDE.md, etc.)
      index.ts
    session/            — Core orchestration
      session.ts        — Session class (central orchestrator)
      loop.ts           — process_input(), the agentic loop
      steering.ts       — steer(), followUp(), drain_steering()
      events.ts         — SessionEventEmitter, async iterator delivery
      loop-detection.ts — Repeating pattern detection
      index.ts
    subagent/           — Subagent spawning and lifecycle
      subagent.ts       — SubAgentHandle, spawn/wait/close
      index.ts
    index.ts            — Package barrel export
```

### Key Components

**Session** — Central orchestrator. Holds conversation state (history as `Turn[]`), dispatches tool calls, manages the event stream, enforces limits. Owns an `AbortController` for cancellation. Exposes `submit(input)`, `steer(message)`, `followUp(message)`, `abort()`, `events()`.

**Agentic Loop** (`process_input`) — The core loop. Calls `Client.stream()`, accumulates the response while emitting real-time events (`ASSISTANT_TEXT_DELTA`, etc.), executes tool calls through the `ExecutionEnvironment`, truncates output, drains steering, checks for loops, and repeats until the model produces a text-only response or a limit is hit.

**ProviderProfile** — Bundles model identity, tool registry, system prompt builder, and capability flags. Each profile wires shared tool executors to provider-specific schemas. `createOpenAIProfile()`, `createAnthropicProfile()`, `createGeminiProfile()` are the factory functions.

**ExecutionEnvironment** — Interface abstracting all file and process operations. `LocalExecutionEnvironment` is the required default. Consumers can implement `DockerExecutionEnvironment`, `KubernetesExecutionEnvironment`, etc. Tool executors receive the environment as a parameter and never touch `node:fs` or `node:child_process` directly.

**ToolRegistry** — `Map<string, RegisteredTool>` with `register()`, `unregister()`, `get()`, `definitions()`. Latest-wins for name collisions (custom tools override profile defaults).

**SessionEventEmitter** — Delivers typed events via `AsyncIterable<SessionEvent>`. Internal buffer + resolve/reject pattern. `TOOL_CALL_END` events carry full untruncated output; the LLM receives the truncated version.

### Data Flow

```
Host App
  |
  | submit("fix the login bug")
  v
Session.process_input()
  |
  | 1. Append UserTurn to history
  | 2. Drain steering queue
  | 3. Build LLMRequest (system prompt + history → messages + tools)
  |
  v
Client.stream(request)  ←── @attractor/llm
  |
  | SDK StreamEvents arrive:
  | STREAM_START → emit ASSISTANT_TEXT_START
  | TEXT_DELTA   → emit ASSISTANT_TEXT_DELTA
  | TOOL_CALL_*  → buffer tool call data
  | FINISH       → accumulate LLMResponse
  |
  v
AssistantTurn appended to history
  |
  | If no tool calls → BREAK (natural completion)
  |
  v
execute_tool_calls()
  |
  | For each ToolCall:
  |   1. Look up RegisteredTool in ToolRegistry
  |   2. Call executor(args, executionEnv)
  |   3. Truncate output (chars first, then lines)
  |   4. Emit TOOL_CALL_END with FULL output
  |   5. Return truncated output as ToolResult
  |
  v
ToolResultsTurn appended to history
  |
  | Drain steering, check loop detection
  | Loop back to step 3
```

### History → Messages Conversion

Each `Turn` type maps to an `@attractor/llm` `Message`:

| Turn Type | SDK Message |
|-----------|-------------|
| `UserTurn` | `userMessage(content)` |
| `SteeringTurn` | `userMessage(content)` (user-role for the LLM) |
| `SystemTurn` | `userMessage(content)` (system-injected, user-role) |
| `AssistantTurn` | `assistantMessage(contentParts)` — text + TOOL_CALL ContentParts |
| `ToolResultsTurn` | One `toolMessage()` per result |

### Streaming by Default

The loop uses `Client.stream()` as the primary path. As SDK `StreamEvent`s arrive, they are mapped to agent-level `SessionEvent`s and emitted in real-time. The response is accumulated from the stream for the `AssistantTurn` using the SDK's new `responseText()`, `responseToolCalls()`, and `responseReasoning()` accessor functions.

### Abort Handling

Session holds an `AbortController`. When `abort()` is called:
1. Signal propagates to the active stream via `LLMRequest.signal`
2. Signal propagates to running shell processes (SIGTERM → 2s → SIGKILL)
3. Loop checks `abortSignaled` at the top of each iteration
4. Subagents receive `close_agent` calls
5. Pending events flushed, `SESSION_END` emitted
6. Session transitions to `CLOSED`

## Existing Patterns

The `@attractor/llm` SDK (complete, merged) establishes patterns that `@attractor/agent` follows:

**Type conventions:** All types use `readonly` fields. Discriminated unions for variant types (like `ContentPart` in the SDK). Pure data objects, not classes. Helper constructors as standalone functions (`systemMessage()`, `userMessage()`), not class methods.

**Package structure:** Layered modules under `src/`. Barrel exports via `index.ts` at each level. Single `src/index.ts` as the package entry point.

**Build tooling:** TypeScript 5.7, tsup 8.5 for bundling, Vitest 4.0 for testing. ESM-only (`"type": "module"`). Colocated unit tests (`*.test.ts` alongside source).

**Error handling:** Class-based error hierarchy. Errors carry structured metadata (`provider`, `statusCode`, `retryable`). The SDK's error types (`AuthenticationError`, `ContextLengthError`, etc.) are consumed by the agent loop for session-level error handling.

**Provider adapters:** The SDK's `ProviderAdapter` interface is stateless. The agent's `ProviderProfile` is a higher-level concept that wraps a provider identity with tools and prompts — it doesn't replace the adapter, it sits above it.

**No new patterns introduced:** The agent package follows all existing conventions. The only new concept is `ExecutionEnvironment`, which has no SDK analogue but follows the same interface-first, implementation-second pattern used for `ProviderAdapter`.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: SDK Fixes & Package Scaffolding

**Goal:** Fix missing `reasoningEffort` field and response accessors in `@attractor/llm`, and scaffold the `@attractor/agent` package with build tooling.

**Components:**

SDK fixes in `packages/llm/`:
- `reasoningEffort` field added to `LLMRequest` in `src/types/request.ts`
- `reasoningEffort` threaded through OpenAI adapter (maps to `reasoning.effort`), Anthropic adapter (maps to thinking budget), Gemini adapter (maps to `thinkingConfig`)
- `responseText()`, `responseToolCalls()`, `responseReasoning()` accessor functions in `src/types/response.ts`
- Barrel export updates

Package scaffolding in `packages/agent/`:
- `package.json` (`@attractor/agent`, ESM-only, peer dependency on `@attractor/llm`)
- `tsconfig.json` (extends root, strict mode)
- `tsup.config.ts` (matching `@attractor/llm` config)
- `vitest.config.ts`
- `src/index.ts` (empty barrel)
- Directory structure for all modules

**Dependencies:** None (first phase)

**Done when:** SDK fixes pass new unit tests, `@attractor/agent` installs, builds, and runs an empty test suite. Covers `coding-agent-loop.AC8.1`–`AC8.4` (SDK fixes).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Types & ExecutionEnvironment

**Goal:** Define all core types and implement `LocalExecutionEnvironment`.

**Components:**

Types in `packages/agent/src/types/`:
- `session.ts` — `SessionConfig`, `SessionState` enum, `SessionEvent`, `EventKind` enum
- `turn.ts` — `UserTurn`, `AssistantTurn`, `ToolResultsTurn`, `SystemTurn`, `SteeringTurn` discriminated union
- `profile.ts` — `ProviderProfile` interface with capability flags
- `environment.ts` — `ExecutionEnvironment` interface, `ExecResult`, `DirEntry`, `EnvVarPolicy`
- `tool.ts` — `RegisteredTool`, `ToolDefinition`, `ToolRegistry`

Execution environment in `packages/agent/src/execution/`:
- `local.ts` — `LocalExecutionEnvironment` implementing all file operations, command execution (process group spawn, timeout enforcement with SIGTERM/SIGKILL), env var filtering, grep (ripgrep with fallback), glob

**Dependencies:** Phase 1 (package exists)

**Done when:** All types compile, `LocalExecutionEnvironment` passes tests for file read/write, command execution, timeout enforcement, env var filtering, grep, and glob. Covers `coding-agent-loop.AC4.1`–`AC4.6` (execution environment).
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Tool Implementations & Truncation

**Goal:** Implement all shared tools and the output truncation pipeline.

**Components:**

Shared tools in `packages/agent/src/tools/`:
- `read-file.ts` — Read with line numbers, offset/limit, image detection
- `write-file.ts` — Write with parent directory creation
- `edit-file.ts` — Exact string match replacement, replace_all, fuzzy matching fallback
- `shell.ts` — Shell execution delegating to `ExecutionEnvironment.execCommand()`
- `grep.ts` — Regex search delegating to `ExecutionEnvironment.grep()`
- `glob.ts` — Pattern matching delegating to `ExecutionEnvironment.glob()`
- `apply-patch.ts` — v4a format parser (grammar: `*** Begin Patch` / `*** End Patch`, operations: Add/Delete/Update File, hunk matching with context lines, fuzzy matching fallback)

Truncation in `packages/agent/src/truncation/`:
- `truncate.ts` — `truncateToolOutput(output, toolName, config)`: character-based truncation first (head_tail or tail mode), then line-based truncation where configured. Default limits from spec Section 5.2.

**Dependencies:** Phase 2 (types, ExecutionEnvironment)

**Done when:** All shared tools pass unit tests (including edge cases: empty files, binary detection, non-unique edit strings, patch parse errors, command timeouts). Truncation passes tests for both character and line modes, pathological cases (10MB single-line input), and all default limits. Covers `coding-agent-loop.AC3.1`–`AC3.5` (tool execution), `coding-agent-loop.AC5.1`–`coding-agent-loop.AC5.6` (truncation).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Event System, Session & Agentic Loop

**Goal:** Implement the core Session class, event emitter, and the agentic loop (`process_input`).

**Components:**

Event system in `packages/agent/src/session/`:
- `events.ts` — `SessionEventEmitter` with async iterator delivery (internal buffer, resolve/reject pattern, `SESSION_END` signals completion). All 13 `EventKind` values emitted at correct times.

Session and loop in `packages/agent/src/session/`:
- `session.ts` — `Session` class: holds state, exposes `submit()`, `steer()`, `followUp()`, `abort()`, `events()`. State machine: `IDLE` → `PROCESSING` → `IDLE`/`AWAITING_INPUT`/`CLOSED`.
- `loop.ts` — `processInput()`: the core loop. Streams via `Client.stream()`, maps SDK events to agent events, accumulates response, executes tools, truncates, drains steering, checks limits.
- `steering.ts` — `steer()` and `followUp()` queue management, `drainSteering()` injection.
- `loop-detection.ts` — Tool call signature tracking, repeating pattern detection (length 1, 2, or 3 within configurable window).

**Dependencies:** Phase 3 (tools, truncation), Phase 2 (types)

**Done when:** Session lifecycle works (create → submit → events → idle → submit again → close). Loop executes tools and loops until natural completion. Round/turn limits enforce correctly. Abort cancels in-flight work. Steering injects between tool rounds. Follow-up triggers after completion. Loop detection warns on repeating patterns. Covers `coding-agent-loop.AC1.1`–`AC1.8` (core loop), `coding-agent-loop.AC6.1`–`AC6.4` (steering), `coding-agent-loop.AC10.1`–`AC10.4` (events).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: System Prompts & Project Doc Discovery

**Goal:** Implement layered system prompt construction and project document discovery.

**Components:**

Prompts in `packages/agent/src/prompts/`:
- `builder.ts` — Assembles system prompt from 5 layers: (1) provider-specific base instructions, (2) environment context block (XML format with platform, git, working dir, date, model), (3) tool descriptions (from profile), (4) project-specific instructions, (5) user instruction override.
- `discovery.ts` — `discoverProjectDocs(workingDir, profileId)`: walks from git root to working dir, loads `AGENTS.md` (always) + provider-specific files (`CLAUDE.md`, `.codex/instructions.md`, `GEMINI.md`). 32KB budget with truncation marker. Root-level loaded first, subdirectory files appended.

Git context snapshot:
- Captured at session start via shell commands (`git branch`, `git status --short`, `git log --oneline -10`). Included in environment context block.

**Dependencies:** Phase 4 (session), Phase 2 (ExecutionEnvironment for git commands)

**Done when:** System prompt includes all 5 layers in correct order. Project docs discovered from git root, filtered by profile, respect 32KB budget. Git context captured correctly. Covers `coding-agent-loop.AC9.1`–`AC9.6` (system prompts).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Provider Profiles

**Goal:** Implement all three provider profiles with native tool definitions and system prompts.

**Components:**

Profiles in `packages/agent/src/profiles/`:
- `openai/` — `createOpenAIProfile(model, options?)`: codex-rs-aligned. Tools: `read_file`, `apply_patch` (replaces edit_file/write_file for edits), `write_file`, `shell` (10s default timeout), `grep`, `glob`, subagent tools. System prompt mirrors codex-rs topics: identity, apply_patch conventions, AGENTS.md, coding best practices.
- `anthropic/` — `createAnthropicProfile(model, options?)`: Claude Code-aligned. Tools: `read_file`, `write_file`, `edit_file` (old_string/new_string native), `shell` (120s default timeout), `grep`, `glob`, subagent tools. System prompt mirrors Claude Code topics: identity, edit_file guidance (old_string must be unique), read-before-edit, file operation preferences.
- `gemini/` — `createGeminiProfile(model, options?)`: gemini-cli-aligned. Tools: `read_file`, `write_file`, `edit_file`, `shell` (10s default timeout), `grep`, `glob`, `list_dir`, subagent tools. System prompt mirrors gemini-cli topics: identity, GEMINI.md conventions, tool usage.

Each profile wires shared tool executors (from Phase 3) to provider-specific `ToolDefinition` schemas. Custom tools can be registered on top via `profile.toolRegistry.register()`.

**Dependencies:** Phase 5 (prompt builder), Phase 3 (shared tools)

**Done when:** All three profiles produce correct tool definitions and system prompts. Custom tool registration overrides defaults. Provider-specific schemas match native conventions (apply_patch for OpenAI, edit_file for Anthropic/Gemini). Covers `coding-agent-loop.AC2.1`–`AC2.6` (provider profiles).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Subagents

**Goal:** Implement subagent spawning, communication, and lifecycle management.

**Components:**

Subagent system in `packages/agent/src/subagent/`:
- `subagent.ts` — `SubAgentHandle` (id, session, status), `SubAgentResult` (output, success, turnsUsed). Subagent tools: `spawn_agent` (creates child Session with shared ExecutionEnvironment, independent history, configurable model/turn limit), `send_input` (queues message to child), `wait` (blocks until child completes), `close_agent` (aborts child).

Subagent tools registered on all profiles (Phase 6). Executor closures bind to parent Session for access to `session.subagents` map.

Depth limiting: parent depth 0, child depth 1. `maxSubagentDepth` check prevents sub-sub-agents. Configurable via `SessionConfig`.

**Dependencies:** Phase 4 (Session), Phase 6 (profiles register subagent tools)

**Done when:** Subagents spawn with independent history, share filesystem, respect depth limits, return results to parent. `send_input`, `wait`, `close_agent` all work correctly. Covers `coding-agent-loop.AC7.1`–`AC7.6` (subagents).
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Error Handling, Integration Tests & Parity Matrix

**Goal:** Complete error handling, run integration smoke tests against Anthropic, and validate cross-provider parity.

**Components:**

Error handling in `packages/agent/src/session/`:
- Tool errors → error result to LLM (`is_error: true`), model can recover
- SDK transient errors (429, 500-503) → handled by `@attractor/llm` retry layer
- `AuthenticationError` → surface immediately, session → CLOSED
- `ContextLengthError` → emit warning, session → CLOSED
- Graceful shutdown: cancel stream → SIGTERM processes → 2s → SIGKILL → flush events → SESSION_END → close subagents → CLOSED

Integration tests in `packages/agent/tests/integration/`:
- Smoke test against Anthropic (real API key): file creation, read-then-edit, shell execution, truncation verification, steering mid-task, subagent spawn
- Cross-provider parity matrix: unit-tested for all three profiles (mock LLM responses), integration-tested for Anthropic

Context window awareness:
- Track approximate token usage (1 token ≈ 4 chars). Emit warning event at 80% of `contextWindowSize`.

**Dependencies:** All previous phases

**Done when:** All error paths tested. Integration smoke test passes against Anthropic. Parity matrix passes for all three profiles. Context window warnings fire correctly. Covers `coding-agent-loop.AC11.1`–`AC11.5` (error handling), `coding-agent-loop.AC12.1`–`AC12.3` (integration).
<!-- END_PHASE_8 -->

## Additional Considerations

**SDK dependency:** `@attractor/agent` declares `@attractor/llm` as a peer dependency. The SDK fixes in Phase 1 are prerequisites — the agent package cannot function without `reasoningEffort` and response accessors.

**apply_patch parser complexity:** The v4a format parser (Phase 3) is the most complex individual component. It needs to handle: multi-file patches, multi-hunk updates, context-based hunk matching, fuzzy matching fallback (whitespace normalization, Unicode equivalence), and clear error messages when matching fails. This is a self-contained parser that warrants thorough unit testing.

**System prompt fidelity:** The Anthropic profile's system prompt should be studied against the community-extracted Claude Code prompts (Piebald-AI repository) to ensure topic coverage matches. OpenAI and Gemini profiles use placeholder prompts covering the right topics, swappable for real ones when available.

**Streaming accumulation:** The loop consumes `Client.stream()` and must accumulate the final `LLMResponse` from stream events. The SDK provides `StreamEvent` types but the agent loop needs to build the complete response (including all `ContentPart`s) from the delta events. The SDK's new `responseText()`, `responseToolCalls()`, `responseReasoning()` helpers work on the accumulated response, not during streaming.

**Concurrency model:** Tool calls within a single round can execute in parallel when `supportsParallelToolCalls` is true (using `Promise.allSettled()`). The agentic loop itself is single-threaded (one `process_input` at a time per Session). Subagents run their own loops concurrently.
