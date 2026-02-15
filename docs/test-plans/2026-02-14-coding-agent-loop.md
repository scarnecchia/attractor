# Coding Agent Loop — Human Test Plan

Generated: 2026-02-15

## Prerequisites

- Node.js >= 20.0.0 installed
- Repository cloned at `/Users/scarndp/dev/attractor`
- Dependencies installed: `npm install` from repo root
- Unit tests passing: `cd packages/agent && npx vitest run` (expect 475 pass)
- LLM unit tests passing: `cd packages/llm && npx vitest run` (expect 370 pass, 45 skipped)
- At least one API key available: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`

## Phase 1: Session Lifecycle

| Step | Action | Expected |
|------|--------|----------|
| 1 | Import `createSession` from `@attractor/agent`. Create a session with Anthropic profile, mock client, mock environment. Call `session.state()`. | Returns `'IDLE'`. |
| 2 | Call `session.submit('Hello')` with a mock client that returns a text-only response. After submit resolves, call `session.state()`. | Returns `'IDLE'` (returned from PROCESSING). |
| 3 | Iterate `session.events()` with `for await`. Verify first event has `kind: 'SESSION_START'` and a non-empty `sessionId`. | SESSION_START event received with valid sessionId string. |
| 4 | Call `session.abort()`. Check `session.state()`. Call `session.submit('test')`. | State is `'CLOSED'`. Submit throws an error. |
| 5 | Call `session.abort()` a second time on the same already-closed session. | Does not throw. Idempotent behaviour confirmed. |

## Phase 2: Agentic Loop Behaviour

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create session with mock client that returns a tool call followed by text. Submit input and collect all events. | Events include TOOL_CALL_START, TOOL_CALL_END (with executor output), then ASSISTANT_TEXT_DELTA, ASSISTANT_TEXT_END. Loop exits after text response. |
| 2 | Set `maxToolRoundsPerInput: 2`. Mock client returns tool calls indefinitely. Submit input. | After 2 tool rounds, a TURN_LIMIT event is emitted. Loop exits. |
| 3 | Set `maxTurns: 3`. Submit 4 sequential inputs (each returns text). | Fourth submit triggers TURN_LIMIT. Session stops accepting further loops. |
| 4 | Create session with mock client that returns the same tool call 6 times in a row. Submit input. | LOOP_DETECTION event emitted after 5th repetition (pattern length 1, 5+ repeats). |

## Phase 3: Tool Dispatch and Execution

| Step | Action | Expected |
|------|--------|----------|
| 1 | Register a custom tool `my_tool` with executor `async (args) => args.message`. Dispatch tool call with `{ message: 'hello' }`. | Returns result with content `'hello'`. |
| 2 | Dispatch a tool call for name `nonexistent_tool`. | Returns error result with message indicating unknown tool. No exception thrown. |
| 3 | Register a tool whose executor throws `new Error('boom')`. Dispatch tool call. | Returns error result containing `'boom'`. No unhandled exception. |
| 4 | Create `LocalExecutionEnvironment` pointed at a real temp directory. Call `readFile` on a file with 10 lines, offset 3, limit 2. | Returns lines 3-4 with line numbers prefixed. |
| 5 | Call `writeFile` to a path with non-existent parent directories (e.g., `/tmp/test-agent-xyz/a/b/c/file.txt`). | File is created. Parent directories `a/b/c` created automatically. |
| 6 | Call `execCommand('echo hello')`. Verify stdout, stderr, exitCode, durationMs. | stdout: `'hello\n'`, stderr: `''`, exitCode: 0, durationMs > 0. |
| 7 | Call `execCommand('sleep 30')` with timeout of 100ms. | Returns `timedOut: true`, exitCode is non-zero or null, output contains timeout message. |

## Phase 4: Truncation Pipeline

| Step | Action | Expected |
|------|--------|----------|
| 1 | Pass a 200,000-character string through truncation with default shell limits. | Output is truncated to character limit first. Line count is within shell default (256 lines). Contains WARNING marker indicating truncation. |
| 2 | Pass a 10MB string (10,000,000 characters) through truncation. | Completes without crash or hang. Output is truncated to configured limits. |
| 3 | Pass a short (100 char) string through truncation. | Output is unchanged. No truncation markers added. |

## Phase 5: Provider Profiles

| Step | Action | Expected |
|------|--------|----------|
| 1 | Import OpenAI profile. List tool definitions. | Contains: read_file, apply_patch, write_file, shell, grep, glob (6 tools). Does NOT contain edit_file. |
| 2 | Import Anthropic profile. List tool definitions. | Contains: read_file, edit_file, write_file, shell, grep, glob (6 tools). edit_file has old_string/new_string parameters. Does NOT contain apply_patch. |
| 3 | Import Gemini profile. List tool definitions. | Contains: read_file, edit_file, write_file, shell, grep, glob, list_dir (7 tools). Does NOT contain apply_patch. |
| 4 | Build system prompt from Anthropic profile. | Contains "Claude Code" identity string, coding guidance, and context sections in correct 5-layer order. |
| 5 | Register custom tool `custom_read` on Anthropic profile's toolRegistry. List definitions. | Contains 7 tools (6 defaults + custom_read). |
| 6 | Register custom tool named `read_file` (same as built-in). Get definition for `read_file`. | Returns the custom version (latest-wins override). Original built-in is replaced. |

## Phase 6: Steering and Follow-Up

| Step | Action | Expected |
|------|--------|----------|
| 1 | Call `session.steer('change approach')` before `session.submit('input')`. Check history after submit completes. | History contains a turn with `kind: 'steering'` and content `'change approach'` before the assistant turn. |
| 2 | Call `session.followUp('next question')` then `session.submit('first input')`. Check history after both complete. | History contains two user turns: `'first input'` and `'next question'`. Two LLM round trips occurred. |

## Phase 7: Subagent System

| Step | Action | Expected |
|------|--------|----------|
| 1 | Call `spawn_agent` tool with `maxSubagentDepth: 2`, `currentDepth: 0`. | Returns a child session with independent (empty) history, same environment reference. |
| 2 | Call `spawn_agent` with `currentDepth` equal to `maxSubagentDepth`. | Returns error result indicating depth limit reached. No child created. |
| 3 | Spawn a child agent, send input via `send_input`, call `wait`. | wait blocks until child completes. Returns `{ output, success, turnsUsed }`. |
| 4 | Spawn a child agent, call `close_agent`. | Child session aborted. Child state is CLOSED. |

## Phase 8: Error Handling

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create session with mock client that throws `AuthenticationError`. Submit input. Collect events. | ERROR event emitted with AuthenticationError. Session transitions to CLOSED. |
| 2 | Create session with mock client that throws `ContextLengthError`. Submit input. Collect events. | CONTEXT_WARNING event emitted with `usagePercent: 1.0`. ERROR event emitted. Session transitions to CLOSED. |
| 3 | Create session with mock client that throws `RateLimitError`. Submit input. | ERROR event emitted. Session transitions to CLOSED (retryable error that exhausted retries). |
| 4 | Create context tracker with 100,000 token context window. Add turns totalling ~85,000 tokens (340,000 chars). | CONTEXT_WARNING event emitted (above 80% threshold). |

## End-to-End: Full Agentic Conversation (requires API key)

**Prerequisites:** `ANTHROPIC_API_KEY` set in environment.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create session with Anthropic profile, `LocalExecutionEnvironment` pointed at a temp directory, real `Client.fromEnv()`. | Session created in IDLE state. |
| 2 | Iterate `session.events()` in background. Submit: "Create a file called hello.txt with the content 'Hello World'". | Events flow: SESSION_START, ASSISTANT_TEXT_START/DELTA/END, TOOL_CALL_START (write_file), TOOL_CALL_END (success), ASSISTANT_TEXT_START/DELTA/END (confirmation). File exists at `{tmpdir}/hello.txt` with content `Hello World`. |
| 3 | Submit: "Read hello.txt and tell me what it says". | TOOL_CALL_START (read_file), TOOL_CALL_END (returns file content with line numbers), ASSISTANT_TEXT (mentions "Hello World"). |
| 4 | Submit: "Run the command 'ls -la' in the current directory". | TOOL_CALL_START (shell), TOOL_CALL_END (directory listing including hello.txt), ASSISTANT_TEXT (describes listing). |
| 5 | Call `session.abort()`. | SESSION_END event emitted. State is CLOSED. No further events emitted. |
| 6 | Verify `session.history()`. | Contains alternating user/assistant/tool_results turns for all 3 interactions. |

## End-to-End: Cross-Provider Parity

| Step | Action | Expected |
|------|--------|----------|
| 1 | For each profile (openai, anthropic, gemini): extract tool definitions from `toolRegistry.definitions()`. | Each profile returns valid JSON-schema tool definitions. All have read_file, write_file, shell, grep, glob. OpenAI has apply_patch; Anthropic/Gemini have edit_file; Gemini additionally has list_dir. |
| 2 | For each profile: create session with mock client returning one tool call then text. Submit input. | Loop completes successfully for all three profiles. Tool is dispatched, result returned, text response generated. |

## End-to-End: Truncation Under Load

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create session with real environment. Submit a command that generates >50,000 characters of output (e.g., `seq 1 100000`). | TOOL_CALL_END event carries the full untruncated output (>50k chars). The history sent to LLM on the next turn contains the truncated version (within configured char/line limits). |

## Traceability Matrix

| AC | Automated Test | Manual Step |
|----|----------------|-------------|
| AC1.1 | session.test.ts | Phase 1, Step 1 |
| AC1.2 | loop.test.ts | Phase 2, Step 1 |
| AC1.3 | loop.test.ts, session.test.ts | Phase 2, Step 1 |
| AC1.4 | session.test.ts | Phase 6, Steps 1-2 |
| AC1.5 | loop.test.ts | Phase 2, Step 2 |
| AC1.6 | loop.test.ts | Phase 2, Step 3 |
| AC1.7 | loop.test.ts | Phase 1, Step 4 |
| AC1.8 | loop-detection.test.ts | Phase 2, Step 4 |
| AC2.1 | openai-profile.test.ts | Phase 5, Step 1 |
| AC2.2 | anthropic-profile.test.ts | Phase 5, Step 2 |
| AC2.3 | gemini-profile.test.ts | Phase 5, Step 3 |
| AC2.4 | All profile test files | Phase 5, Step 4 |
| AC2.5 | custom-tools.test.ts, tool.test.ts | Phase 5, Step 5 |
| AC2.6 | custom-tools.test.ts, tool.test.ts | Phase 5, Step 6 |
| AC3.1 | dispatch.test.ts | Phase 3, Step 1 |
| AC3.2 | dispatch.test.ts | Phase 3, Step 2 |
| AC3.3 | dispatch.test.ts | Phase 3, Step 2 |
| AC3.4 | dispatch.test.ts | Phase 3, Step 3 |
| AC3.5 | dispatch.test.ts | Phase 3, Step 1 |
| AC4.1 | local.test.ts | Phase 3, Step 4 |
| AC4.2 | local.test.ts | Phase 3, Step 5 |
| AC4.3 | local.test.ts | Phase 3, Step 6 |
| AC4.4 | local.test.ts | Phase 3, Step 7 |
| AC4.5 | local.test.ts | Phase 3, Step 7 |
| AC4.6 | local.test.ts | Phase 3, Step 6 |
| AC5.1 | truncate.test.ts | Phase 4, Step 1 |
| AC5.2 | truncate.test.ts | Phase 4, Step 1 |
| AC5.3 | truncate.test.ts | Phase 4, Step 1 |
| AC5.4 | truncate.test.ts | Phase 4, Step 1 |
| AC5.5 | truncate.test.ts | Phase 4, Step 2 |
| AC5.6 | truncate.test.ts | Phase 4, Step 3 |
| AC6.1 | steering.test.ts | Phase 6, Step 1 |
| AC6.2 | steering.test.ts | Phase 6, Step 2 |
| AC6.3 | loop.test.ts | Phase 6, Step 1 |
| AC6.4 | steering.test.ts, loop.test.ts | Phase 6, Step 1 |
| AC7.1 | subagent.test.ts | Phase 7, Step 1 |
| AC7.2 | subagent.test.ts | Phase 7, Step 1 |
| AC7.3 | subagent.test.ts | Phase 7, Step 3 |
| AC7.4 | subagent.test.ts | Phase 7, Step 4 |
| AC7.5 | subagent.test.ts | Phase 7, Step 2 |
| AC7.6 | subagent.test.ts | Phase 7, Step 3 |
| AC8.1 | openai.test.ts, request.test.ts, gemini.test.ts | N/A (LLM SDK layer) |
| AC8.2 | openai.test.ts, request.test.ts, gemini.test.ts | N/A (LLM SDK layer) |
| AC8.3 | response.test.ts | N/A (LLM SDK layer) |
| AC8.4 | response.test.ts | N/A (LLM SDK layer) |
| AC9.1 | builder.test.ts | Phase 5, Step 4 |
| AC9.2 | builder.test.ts | Phase 5, Step 4 |
| AC9.3 | discovery.test.ts | Phase 5, Step 4 |
| AC9.4 | discovery.test.ts | Phase 5, Step 4 |
| AC9.5 | discovery.test.ts | Phase 4, Step 1 |
| AC9.6 | builder.test.ts | Phase 5, Step 4 |
| AC10.1 | events.test.ts, loop.test.ts | Phase 2, Step 1 |
| AC10.2 | events.test.ts | Phase 1, Step 3 |
| AC10.3 | loop.test.ts | Phase 2, Step 1 |
| AC10.4 | events.test.ts, session.test.ts | Phase 1, Steps 3-4 |
| AC11.1 | error-handling.test.ts | Phase 3, Step 3 |
| AC11.2 | error-handling.test.ts, session.test.ts | Phase 8, Step 1 |
| AC11.3 | error-handling.test.ts, session.test.ts | Phase 8, Step 2 |
| AC11.4 | context-tracking.test.ts | Phase 8, Step 4 |
| AC11.5 | shutdown.test.ts | Phase 1, Steps 4-5 |
| AC12.1 | smoke.test.ts | E2E: Full Agentic Conversation |
| AC12.2 | smoke.test.ts | E2E: Truncation Under Load |
| AC12.3 | parity-matrix.test.ts | E2E: Cross-Provider Parity |
