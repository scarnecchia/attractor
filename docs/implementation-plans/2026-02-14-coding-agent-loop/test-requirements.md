# Test Requirements — Coding Agent Loop

## Overview

This document maps every acceptance criterion from the coding agent loop design plan (`coding-agent-loop.AC1.1` through `coding-agent-loop.AC12.3`) to either an automated test or a documented human verification approach. There are 53 acceptance criteria total across 12 groups.

Test files follow the colocated convention: unit tests as `*.test.ts` alongside source, integration tests under `tests/integration/`.

---

## Automated Test Coverage

| AC ID | Description | Test Type | Test File | Phase |
|-------|-------------|-----------|-----------|-------|
| coding-agent-loop.AC1.1 | Session created with ProviderProfile, ExecutionEnvironment, and Client; transitions to IDLE | unit | `packages/agent/src/session/session.test.ts` | Phase 4 |
| coding-agent-loop.AC1.2 | `process_input()` runs the loop: LLM stream -> tool execution -> loop until natural completion | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC1.3 | Natural completion: model responds with no tool calls, loop exits, session returns to IDLE | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC1.4 | Multiple sequential inputs work: submit -> complete -> submit again | unit | `packages/agent/src/session/session.test.ts` | Phase 4 |
| coding-agent-loop.AC1.5 | `max_tool_rounds_per_input` reached -> loop stops, emits TURN_LIMIT | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC1.6 | `max_turns` across session reached -> loop stops, emits TURN_LIMIT | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC1.7 | Abort signal -> cancels LLM stream, kills processes, session transitions to CLOSED | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC1.8 | Loop detection: repeating tool call pattern triggers SteeringTurn warning and LOOP_DETECTION event | unit | `packages/agent/src/session/loop-detection.test.ts`, `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC2.1 | OpenAI profile provides codex-rs-aligned tools including `apply_patch` (v4a format) | unit | `packages/agent/src/profiles/openai/openai-profile.test.ts` | Phase 6 |
| coding-agent-loop.AC2.2 | Anthropic profile provides Claude Code-aligned tools including `edit_file` (old_string/new_string) | unit | `packages/agent/src/profiles/anthropic/anthropic-profile.test.ts` | Phase 6 |
| coding-agent-loop.AC2.3 | Gemini profile provides gemini-cli-aligned tools including `list_dir` | unit | `packages/agent/src/profiles/gemini/gemini-profile.test.ts` | Phase 6 |
| coding-agent-loop.AC2.4 | Each profile produces a provider-specific system prompt covering identity, tool usage, and coding guidance | unit | `packages/agent/src/profiles/openai/openai-profile.test.ts`, `packages/agent/src/profiles/anthropic/anthropic-profile.test.ts`, `packages/agent/src/profiles/gemini/gemini-profile.test.ts` | Phase 6 |
| coding-agent-loop.AC2.5 | Custom tools registered on top of any profile via `toolRegistry.register()` | unit | `packages/agent/src/profiles/custom-tools.test.ts`, `packages/agent/src/types/tool.test.ts` | Phase 6 (test), Phase 2 (implementation) |
| coding-agent-loop.AC2.6 | Tool name collisions resolved: custom registration overrides profile default | unit | `packages/agent/src/profiles/custom-tools.test.ts`, `packages/agent/src/types/tool.test.ts` | Phase 6 (test), Phase 2 (implementation) |
| coding-agent-loop.AC3.1 | Tool calls dispatched through ToolRegistry, executor receives (args, executionEnv) | unit | `packages/agent/src/tools/dispatch.test.ts` | Phase 3 |
| coding-agent-loop.AC3.2 | Unknown tool name -> error result returned to LLM (is_error: true), not an exception | unit | `packages/agent/src/tools/dispatch.test.ts` | Phase 3 |
| coding-agent-loop.AC3.3 | Invalid JSON arguments -> validation error result returned to LLM | unit | `packages/agent/src/tools/dispatch.test.ts` | Phase 3 |
| coding-agent-loop.AC3.4 | Tool execution throws -> caught, returned as error result | unit | `packages/agent/src/tools/dispatch.test.ts` | Phase 3 |
| coding-agent-loop.AC3.5 | Parallel tool execution works when `supportsParallelToolCalls` is true (Promise.allSettled) | unit | `packages/agent/src/tools/dispatch.test.ts` | Phase 3 |
| coding-agent-loop.AC4.1 | `LocalExecutionEnvironment` reads files with line numbers, respects offset/limit | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC4.2 | `LocalExecutionEnvironment` writes files, creates parent directories | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC4.3 | Command execution spawns in process group, captures stdout/stderr, records duration | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC4.4 | Command timeout default is 10s; overridable per-call via `timeout_ms` | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC4.5 | Timed-out command: process group receives SIGTERM, then SIGKILL after 2s; timeout message in output | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC4.6 | Env var filtering excludes `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL` by default; always includes PATH, HOME, etc. | unit | `packages/agent/src/execution/local.test.ts` | Phase 2 |
| coding-agent-loop.AC5.1 | Character-based truncation runs FIRST on all tool outputs | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC5.2 | Line-based truncation runs SECOND where configured (shell: 256, grep: 200, glob: 500) | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC5.3 | head_tail mode keeps first half + last half of chars with WARNING marker | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC5.4 | tail mode drops beginning, keeps end with WARNING marker | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC5.5 | Pathological input (10MB single line) handled by character truncation before line truncation sees it | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC5.6 | Default character limits match spec (read_file: 50k, shell: 30k, grep: 20k, etc.); all overridable via SessionConfig | unit | `packages/agent/src/truncation/truncate.test.ts` | Phase 3 |
| coding-agent-loop.AC6.1 | `steer()` queues message, injected after current tool round as SteeringTurn | unit | `packages/agent/src/session/steering.test.ts`, `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC6.2 | `followUp()` queues message, processed after current input completes (triggers new process_input cycle) | unit | `packages/agent/src/session/steering.test.ts`, `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC6.3 | SteeringTurns converted to user-role messages for the LLM | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC6.4 | Steering drained before first LLM call and after each tool round | unit | `packages/agent/src/session/steering.test.ts`, `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC7.1 | `spawn_agent` creates child Session with independent history and shared ExecutionEnvironment | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC7.2 | Subagent uses parent's ProviderProfile (or overridden model) | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC7.3 | `send_input` queues a message to child; `wait` blocks until child completes | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC7.4 | `close_agent` aborts child session | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC7.5 | Depth limiting: child cannot spawn sub-children (maxSubagentDepth=1 default) | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC7.6 | Subagent results returned to parent as tool results (output, success, turnsUsed) | unit | `packages/agent/src/subagent/subagent.test.ts` | Phase 7 |
| coding-agent-loop.AC8.1 | `reasoningEffort` field on LLMRequest accepted by all adapters | unit | `packages/llm/src/types/request.test.ts`, `packages/llm/src/providers/openai/openai.test.ts`, `packages/llm/src/providers/anthropic/request.test.ts`, `packages/llm/src/providers/gemini/gemini.test.ts` | Phase 1 |
| coding-agent-loop.AC8.2 | Changing `reasoningEffort` mid-session takes effect on next LLM call | unit | `packages/llm/src/providers/openai/openai.test.ts`, `packages/llm/src/providers/anthropic/request.test.ts`, `packages/llm/src/providers/gemini/gemini.test.ts` | Phase 1 |
| coding-agent-loop.AC8.3 | `responseText()` extracts concatenated text from TEXT ContentParts | unit | `packages/llm/src/types/response.test.ts` | Phase 1 |
| coding-agent-loop.AC8.4 | `responseToolCalls()` extracts ToolCall[] from TOOL_CALL ContentParts; `responseReasoning()` extracts thinking text | unit | `packages/llm/src/types/response.test.ts` | Phase 1 |
| coding-agent-loop.AC9.1 | System prompt includes provider-specific base instructions | unit | `packages/agent/src/prompts/builder.test.ts` | Phase 5 |
| coding-agent-loop.AC9.2 | System prompt includes environment context (platform, git, working dir, date, model info) | unit | `packages/agent/src/prompts/builder.test.ts` | Phase 5 |
| coding-agent-loop.AC9.3 | Project docs (AGENTS.md + provider-specific files) discovered from git root to working dir | unit | `packages/agent/src/prompts/discovery.test.ts` | Phase 5 |
| coding-agent-loop.AC9.4 | Only relevant project files loaded (Anthropic loads CLAUDE.md, not GEMINI.md); AGENTS.md always loaded | unit | `packages/agent/src/prompts/discovery.test.ts` | Phase 5 |
| coding-agent-loop.AC9.5 | Project docs exceeding 32KB budget truncated with marker | unit | `packages/agent/src/prompts/discovery.test.ts` | Phase 5 |
| coding-agent-loop.AC9.6 | User instruction override appended last (highest priority) | unit | `packages/agent/src/prompts/builder.test.ts` | Phase 5 |
| coding-agent-loop.AC10.1 | All 13 EventKind values emitted at correct times during session lifecycle | unit | `packages/agent/src/session/events.test.ts`, `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC10.2 | Events delivered via `AsyncIterable<SessionEvent>` (consumed with `for await`) | unit | `packages/agent/src/session/events.test.ts` | Phase 4 |
| coding-agent-loop.AC10.3 | `TOOL_CALL_END` carries full untruncated output | unit | `packages/agent/src/session/loop.test.ts` | Phase 4 |
| coding-agent-loop.AC10.4 | `SESSION_START` and `SESSION_END` bracket the session | unit | `packages/agent/src/session/events.test.ts`, `packages/agent/src/session/session.test.ts` | Phase 4 |
| coding-agent-loop.AC11.1 | Tool execution errors -> error result to LLM (model can recover) | unit | `packages/agent/src/session/error-handling.test.ts`, `packages/agent/src/tools/dispatch.test.ts` | Phase 8 (error-handling), Phase 3 (dispatch) |
| coding-agent-loop.AC11.2 | AuthenticationError -> surface immediately, session -> CLOSED | unit | `packages/agent/src/session/error-handling.test.ts` | Phase 8 |
| coding-agent-loop.AC11.3 | ContextLengthError -> emit warning, session -> CLOSED | unit | `packages/agent/src/session/error-handling.test.ts` | Phase 8 |
| coding-agent-loop.AC11.4 | Context window warning emitted at ~80% usage (1 token ~ 4 chars heuristic) | unit | `packages/agent/src/session/context-tracking.test.ts` | Phase 8 |
| coding-agent-loop.AC11.5 | Graceful shutdown: cancel stream -> kill processes -> flush events -> SESSION_END -> close subagents -> CLOSED | unit | `packages/agent/src/session/shutdown.test.ts` | Phase 8 |
| coding-agent-loop.AC12.1 | Anthropic integration smoke test: file creation, read-then-edit, shell execution with real API key | integration | `packages/agent/tests/integration/smoke.test.ts` | Phase 8 |
| coding-agent-loop.AC12.2 | Truncation verified end-to-end: TOOL_CALL_END has full output, LLM gets truncated version | integration | `packages/agent/tests/integration/smoke.test.ts` | Phase 8 |
| coding-agent-loop.AC12.3 | Cross-provider parity: all three profiles produce correct tool definitions and can run the loop (unit-tested with mocked LLM) | unit | `packages/agent/tests/integration/parity-matrix.test.ts` | Phase 8 |

---

## Human Verification Required

| AC ID | Description | Justification | Verification Approach |
|-------|-------------|---------------|----------------------|
| *(none)* | | | |

All 53 acceptance criteria are fully covered by automated tests. No human verification is required.

---

## Test Summary by Phase

| Phase | Unit Test Files | Integration Test Files | ACs Covered |
|-------|----------------|----------------------|-------------|
| Phase 1 | `packages/llm/src/types/request.test.ts`, `packages/llm/src/providers/openai/openai.test.ts`, `packages/llm/src/providers/anthropic/request.test.ts`, `packages/llm/src/providers/gemini/gemini.test.ts`, `packages/llm/src/types/response.test.ts` | — | AC8.1-AC8.4 |
| Phase 2 | `packages/agent/src/execution/local.test.ts`, `packages/agent/src/types/tool.test.ts` | — | AC4.1-AC4.6, supports AC2.5-AC2.6 |
| Phase 3 | `packages/agent/src/truncation/truncate.test.ts`, `packages/agent/src/tools/dispatch.test.ts`, `packages/agent/src/tools/read-file.test.ts`, `packages/agent/src/tools/write-file.test.ts`, `packages/agent/src/tools/edit-file.test.ts`, `packages/agent/src/tools/shell.test.ts`, `packages/agent/src/tools/grep.test.ts`, `packages/agent/src/tools/glob.test.ts`, `packages/agent/src/tools/apply-patch.test.ts` | — | AC3.1-AC3.5, AC5.1-AC5.6 |
| Phase 4 | `packages/agent/src/session/events.test.ts`, `packages/agent/src/session/loop-detection.test.ts`, `packages/agent/src/session/steering.test.ts`, `packages/agent/src/session/session.test.ts`, `packages/agent/src/session/loop.test.ts` | — | AC1.1-AC1.8, AC6.1-AC6.4, AC10.1-AC10.4 |
| Phase 5 | `packages/agent/src/prompts/discovery.test.ts`, `packages/agent/src/prompts/builder.test.ts`, `packages/agent/src/prompts/git-context.test.ts` | — | AC9.1-AC9.6 |
| Phase 6 | `packages/agent/src/profiles/openai/openai-profile.test.ts`, `packages/agent/src/profiles/anthropic/anthropic-profile.test.ts`, `packages/agent/src/profiles/gemini/gemini-profile.test.ts`, `packages/agent/src/profiles/custom-tools.test.ts` | — | AC2.1-AC2.6 |
| Phase 7 | `packages/agent/src/subagent/subagent.test.ts` | — | AC7.1-AC7.6 |
| Phase 8 | `packages/agent/src/session/error-handling.test.ts`, `packages/agent/src/session/context-tracking.test.ts`, `packages/agent/src/session/shutdown.test.ts` | `packages/agent/tests/integration/smoke.test.ts`, `packages/agent/tests/integration/parity-matrix.test.ts` | AC11.1-AC11.5, AC12.1-AC12.3 |

---

## Test Infrastructure Notes

### Mock Patterns

- **Mock Client**: Used in Phase 4+ unit tests. Returns predefined `StreamEvent` sequences, enabling deterministic loop testing without real API calls. Defined in the session test files, reusable across Phase 8 parity matrix.
- **Mock ExecutionEnvironment**: Used in Phase 2+ unit tests. Wraps a temp directory (`node:os.tmpdir()` + random suffix) or provides in-memory stubs. Used by tool executor tests, discovery tests, and integration-level parity tests.
- **Mock ProviderProfile**: Used in Phase 5 builder tests. Provides minimal `buildSystemPrompt()` and tool registry for prompt assembly verification.

### Integration Test Gating

- Integration tests (`packages/agent/tests/integration/smoke.test.ts`) require `ANTHROPIC_API_KEY` environment variable.
- Tests skip gracefully (not fail) when the key is absent.
- Separate vitest config: `packages/agent/vitest.integration.config.ts` with 60s timeout.
- Run command: `npm run test:integration` (not included in default `npm test`).

### Cross-Cutting Concerns

Several ACs are verified at multiple layers:

| AC ID | Primary Test | Supporting Test(s) | Rationale |
|-------|-------------|--------------------|----|
| AC2.5, AC2.6 | `custom-tools.test.ts` (Phase 6) | `tool.test.ts` (Phase 2) | ToolRegistry override semantics tested at data structure level first, then end-to-end with real profiles |
| AC3.1 | `dispatch.test.ts` (Phase 3) | Individual tool `*.test.ts` files | Dispatch tests verify registry-based routing; individual tool tests verify executor signature compliance |
| AC6.1, AC6.4 | `loop.test.ts` (Phase 4) | `steering.test.ts` (Phase 4) | Steering queue mechanics tested in isolation; integration into the loop tested via mock Client |
| AC10.1 | `loop.test.ts` (Phase 4) | `events.test.ts` (Phase 4) | Event emitter delivery tested in isolation; correct event timing verified within the loop |
| AC11.1 | `error-handling.test.ts` (Phase 8) | `dispatch.test.ts` (Phase 3) | Dispatch catches exceptions at tool layer; error-handling verifies session-level recovery behaviour |
| AC12.2 | `smoke.test.ts` (Phase 8) | `loop.test.ts` (Phase 4) | Loop test verifies truncated vs. untruncated output with mocks; smoke test verifies end-to-end with real API |

---

## Coverage Totals

- **Total acceptance criteria**: 53
- **Automated (unit)**: 50
- **Automated (integration)**: 3
- **Human verification**: 0
- **Unique unit test files**: 22
- **Unique integration test files**: 2
