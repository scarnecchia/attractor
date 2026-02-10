# Unified LLM SDK Design

## Summary

The Unified LLM SDK is a TypeScript library that provides a single, provider-agnostic interface for working with OpenAI (Responses API), Anthropic (Messages API), Google Gemini, and OpenAI-compatible endpoints. It solves the fragmentation problem where each LLM provider exposes different HTTP APIs, message formats, and feature conventions. The library implements a four-layer architecture: Layer 1 defines the `ProviderAdapter` interface and type contracts; Layer 2 provides shared utilities (HTTP/SSE, retry logic, error mapping); Layer 3 is the `Client` class that routes requests to adapters and applies middleware; Layer 4 exposes high-level functions (`generate()`, `stream()`, `generateObject()`, `streamObject()`) with tool execution loops and structured output parsing.

The implementation uses native `fetch()` and requires only two micro-dependencies (`eventsource-parser` for SSE, `partial-json` for incremental JSON repair). Each provider adapter uses that provider's native, preferred API — not a compatibility shim — ensuring access to provider-specific features like reasoning tokens, prompt caching, and extended thinking. Tool calling supports parallel execution via `Promise.allSettled()`, automatic continuation loops, and both active (self-executing) and passive (return-only) modes. The Anthropic adapter auto-injects `cache_control` breakpoints to enable prompt caching transparently. Structured output uses native JSON schema modes for OpenAI/Gemini and tool-based extraction for Anthropic. Error handling follows a class-based hierarchy rooted at `SDKError`, with exponential backoff retry and `Retry-After` header respect. The library ships as a single ESM-only npm package with subpath exports.

## Definition of Done

A TypeScript library (single npm package, ESM-only, Node 18+) implementing the full Unified LLM Client Specification (`unified-llm-spec.md`) using raw HTTP with native `fetch()`. The library provides a 4-layer architecture (Provider Specification, Provider Utilities, Core Client, High-Level API) with 4 provider adapters (OpenAI Responses API, Anthropic Messages API, Gemini native API, OpenAI-compatible Chat Completions). All spec features are implemented: tool calling with parallel execution, middleware chain, full error hierarchy with retry policies, prompt caching (including Anthropic auto-injection of `cache_control`), model catalog, streaming with start/delta/end events, abort signals, and timeouts. Success is validated by the spec's Section 8 Definition of Done checklist including the cross-provider parity matrix and integration smoke test. The other two Attractor specs (coding-agent-loop, attractor pipeline runner) are out of scope.

## Acceptance Criteria

### unified-llm-sdk.AC1: Client Setup & Configuration
- **unified-llm-sdk.AC1.1 Success:** Client.fromEnv() registers adapters for all providers whose API keys are present
- **unified-llm-sdk.AC1.2 Success:** Client constructed programmatically routes to named provider
- **unified-llm-sdk.AC1.3 Success:** Default provider used when request omits provider field
- **unified-llm-sdk.AC1.4 Failure:** ConfigurationError raised when no provider configured and no default set
- **unified-llm-sdk.AC1.5 Success:** Module-level default client lazy-initializes from env on first use
- **unified-llm-sdk.AC1.6 Success:** setDefaultClient() overrides the lazy-initialized client

### unified-llm-sdk.AC2: Middleware
- **unified-llm-sdk.AC2.1 Success:** Middleware executes in registration order for request phase
- **unified-llm-sdk.AC2.2 Success:** Middleware executes in reverse order for response phase
- **unified-llm-sdk.AC2.3 Success:** Middleware wraps streaming calls (can observe/transform events)
- **unified-llm-sdk.AC2.4 Success:** Multiple middleware compose correctly (onion model)

### unified-llm-sdk.AC3: Provider Adapters
- **unified-llm-sdk.AC3.1 Success:** OpenAI adapter uses Responses API, not Chat Completions
- **unified-llm-sdk.AC3.2 Success:** Anthropic adapter uses Messages API with correct headers (x-api-key, anthropic-version)
- **unified-llm-sdk.AC3.3 Success:** Gemini adapter uses native API with ?alt=sse for streaming
- **unified-llm-sdk.AC3.4 Success:** OpenAI-compatible adapter uses Chat Completions for third-party endpoints
- **unified-llm-sdk.AC3.5 Success:** All adapters translate all 5 roles correctly
- **unified-llm-sdk.AC3.6 Success:** provider_options escape hatch passes through provider-specific params
- **unified-llm-sdk.AC3.7 Success:** Anthropic beta headers passed via provider_options

### unified-llm-sdk.AC4: Message & Content Model
- **unified-llm-sdk.AC4.1 Success:** Text-only messages work across all providers
- **unified-llm-sdk.AC4.2 Success:** Image input as base64 data translated correctly per provider
- **unified-llm-sdk.AC4.3 Success:** Image input as URL translated correctly per provider
- **unified-llm-sdk.AC4.4 Success:** Image input as local file path reads, base64-encodes, and sends
- **unified-llm-sdk.AC4.5 Success:** Tool call content parts round-trip (assistant tool calls -> tool results -> next response)
- **unified-llm-sdk.AC4.6 Success:** Anthropic thinking blocks preserved with signatures intact
- **unified-llm-sdk.AC4.7 Success:** Redacted thinking blocks passed through verbatim
- **unified-llm-sdk.AC4.8 Success:** Multimodal messages (text + images) work

### unified-llm-sdk.AC5: Generation
- **unified-llm-sdk.AC5.1 Success:** generate() with simple text prompt returns text response
- **unified-llm-sdk.AC5.2 Success:** generate() with full messages list works
- **unified-llm-sdk.AC5.3 Failure:** generate() with both prompt and messages raises error
- **unified-llm-sdk.AC5.4 Success:** stream() yields TEXT_DELTA events that concatenate to full response
- **unified-llm-sdk.AC5.5 Success:** stream() yields STREAM_START and FINISH with correct metadata
- **unified-llm-sdk.AC5.6 Success:** StreamAccumulator produces response equivalent to complete()
- **unified-llm-sdk.AC5.7 Success:** Abort signal cancels in-flight request, raises AbortError
- **unified-llm-sdk.AC5.8 Success:** Timeouts work (total and per-step)

### unified-llm-sdk.AC6: Error Handling
- **unified-llm-sdk.AC6.1 Success:** HTTP 401 -> AuthenticationError (retryable=false)
- **unified-llm-sdk.AC6.2 Success:** HTTP 429 -> RateLimitError (retryable=true)
- **unified-llm-sdk.AC6.3 Success:** HTTP 500 -> ServerError (retryable=true)
- **unified-llm-sdk.AC6.4 Success:** HTTP 404 -> NotFoundError (retryable=false)
- **unified-llm-sdk.AC6.5 Success:** Retry-After header parsed and set on error
- **unified-llm-sdk.AC6.6 Success:** Message-based classification for ambiguous status codes

### unified-llm-sdk.AC7: Retry
- **unified-llm-sdk.AC7.1 Success:** Exponential backoff with jitter follows correct curve
- **unified-llm-sdk.AC7.2 Success:** Retry-After header overrides backoff when within maxDelay
- **unified-llm-sdk.AC7.3 Success:** Retry-After exceeding maxDelay skips retry, raises immediately
- **unified-llm-sdk.AC7.4 Success:** max_retries=0 disables retries
- **unified-llm-sdk.AC7.5 Success:** Retries apply per-step, not whole multi-step operation
- **unified-llm-sdk.AC7.6 Success:** Streaming does not retry after partial data delivered

### unified-llm-sdk.AC8: Prompt Caching
- **unified-llm-sdk.AC8.1 Success:** Anthropic adapter auto-injects cache_control on system, tools, last user message
- **unified-llm-sdk.AC8.2 Success:** Anthropic adapter auto-includes prompt-caching beta header
- **unified-llm-sdk.AC8.3 Success:** Auto-caching disabled via providerOptions.anthropic.autoCache=false
- **unified-llm-sdk.AC8.4 Success:** Usage.cacheReadTokens populated for all three providers
- **unified-llm-sdk.AC8.5 Success:** Usage.cacheWriteTokens populated for Anthropic
- **unified-llm-sdk.AC8.6 Success:** Multi-turn session shows >50% cache hits on turn 2+

### unified-llm-sdk.AC9: Reasoning Tokens
- **unified-llm-sdk.AC9.1 Success:** OpenAI reasoning_tokens in Usage via Responses API
- **unified-llm-sdk.AC9.2 Success:** reasoning_effort parameter passed through to OpenAI
- **unified-llm-sdk.AC9.3 Success:** Anthropic thinking blocks returned as THINKING content parts
- **unified-llm-sdk.AC9.4 Success:** Thinking block signatures preserved for round-tripping
- **unified-llm-sdk.AC9.5 Success:** Gemini thoughtsTokenCount mapped to reasoning_tokens

### unified-llm-sdk.AC10: Tool Calling
- **unified-llm-sdk.AC10.1 Success:** Active tools trigger automatic execution loop
- **unified-llm-sdk.AC10.2 Success:** Passive tools return tool calls without looping
- **unified-llm-sdk.AC10.3 Success:** max_tool_rounds respected
- **unified-llm-sdk.AC10.4 Success:** max_tool_rounds=0 disables automatic execution
- **unified-llm-sdk.AC10.5 Success:** Parallel tool calls executed concurrently via Promise.allSettled
- **unified-llm-sdk.AC10.6 Success:** All parallel results sent in single continuation request
- **unified-llm-sdk.AC10.7 Failure:** Tool execution error sent as is_error result, not exception
- **unified-llm-sdk.AC10.8 Failure:** Unknown tool call sends error result, not exception
- **unified-llm-sdk.AC10.9 Success:** ToolChoice modes (auto, none, required, named) translated per provider
- **unified-llm-sdk.AC10.10 Success:** StepResult tracks each step's calls, results, and usage

### unified-llm-sdk.AC11: Structured Output
- **unified-llm-sdk.AC11.1 Success:** generateObject() with OpenAI uses native json_schema
- **unified-llm-sdk.AC11.2 Success:** generateObject() with Gemini uses native responseSchema
- **unified-llm-sdk.AC11.3 Success:** generateObject() with Anthropic uses tool-based extraction
- **unified-llm-sdk.AC11.4 Success:** generateObject() returns parsed, validated output
- **unified-llm-sdk.AC11.5 Failure:** generateObject() raises NoObjectGeneratedError on parse failure
- **unified-llm-sdk.AC11.6 Success:** streamObject() yields progressively larger partial objects
- **unified-llm-sdk.AC11.7 Success:** streamObject() final object validates against schema

### unified-llm-sdk.AC12: Cross-Provider Parity
- **unified-llm-sdk.AC12.1 Success:** Spec Section 8.9 parity matrix — all cells pass for all 3 providers

### unified-llm-sdk.AC13: Integration Smoke Test
- **unified-llm-sdk.AC13.1 Success:** Spec Section 8.10 end-to-end test passes against real APIs

## Glossary

- **Provider Adapter**: A class implementing `ProviderAdapter` interface that translates unified SDK requests into a provider's native API format and translates responses back into unified types.
- **Responses API**: OpenAI's newer API (`/v1/responses`) that surfaces reasoning tokens and supports built-in tools. Distinct from the older Chat Completions API.
- **Messages API**: Anthropic's native API (`/v1/messages`) requiring strict user/assistant message alternation, supporting extended thinking blocks and prompt caching via `cache_control` annotations.
- **SSE (Server-Sent Events)**: HTTP streaming protocol used by all three providers for real-time token delivery. Parsed by `eventsource-parser`.
- **Middleware**: Composable functions that wrap provider calls to add cross-cutting concerns (logging, retries, caching). Execute in onion model order.
- **Tool Calling**: Mechanism where the model requests execution of defined functions. Active tools are automatically executed in a loop; passive tools are returned without execution.
- **Prompt Caching**: Provider feature reusing computation from unchanged conversation prefixes. OpenAI/Gemini automatic; Anthropic requires explicit `cache_control` breakpoints (auto-injected by the SDK).
- **Reasoning Tokens**: Tokens produced during model reasoning before generating the final response. Tracked in `Usage` but not visible in response text (except Anthropic thinking blocks).
- **Tool-based Extraction**: Strategy for structured output on providers without native JSON schema support. Defines a synthetic tool whose parameters match the desired schema, forces the model to call it, and parses the tool call arguments as output.
- **Message Alternation**: Anthropic constraint requiring strict user/assistant alternation. The adapter merges consecutive same-role content blocks to enforce this.
- **Cache Control Breakpoint**: Anthropic annotation (`cache_control: { type: "ephemeral" }`) marking prompt caching boundaries. Auto-injected on system prompts, tools, and last user message.
- **ContentPart**: Tagged union representing one piece of message content. Discriminated by `kind` (TEXT, IMAGE, TOOL_CALL, THINKING, etc.). Enables multimodal messages.
- **StreamEvent**: Typed event in the streaming API following start/delta/end lifecycle pattern.
- **StepResult**: A single request/response cycle within a multi-step tool execution loop. Tracks tool calls, results, and usage per step.
- **Model Catalog**: Built-in registry of known models with metadata (context window, capabilities, costs). Helps coding agents select valid model identifiers.
- **Provider Options**: Escape hatch (`provider_options` on Request) for provider-specific parameters that don't map to the unified model.
- **Thinking Block**: Anthropic feature where the model outputs reasoning content separate from the final response. Preserved with signatures for round-tripping.
- **Synthetic Tool Call ID**: UUID generated by the adapter when a provider (like Gemini) doesn't assign IDs to tool calls.
- **eventsource-parser**: Micro-library (~1.5KB) for parsing SSE streams.
- **partial-json**: Micro-library (~2KB) for incrementally repairing incomplete JSON. Used by `streamObject()`.
- **tsup**: Zero-config TypeScript bundler producing ESM output with declaration files.
- **Vitest**: Fast test framework for TypeScript projects.

## Architecture

### Four-Layer Structure

The library follows the spec's four-layer architecture, implemented as a single npm package (`@attractor/llm`) with subpath exports. Each layer has a clear responsibility boundary enforced by directory structure.

```
packages/llm/src/
├── types/          Layer 1: Provider Specification (interfaces, shared types, error classes)
├── utils/          Layer 2: Provider Utilities (HTTP, SSE, retry, error mapping)
├── client/         Layer 3: Core Client (routing, middleware, configuration)
├── api/            Layer 4: High-Level API (generate, stream, generate_object, stream_object)
├── providers/      Provider adapter implementations (OpenAI, Anthropic, Gemini, OpenAI-compatible)
├── catalog/        Model catalog data and lookup functions
└── index.ts        Root export (re-exports Layer 4 high-level API + core types)
```

**Layer 1 (types/)** defines the stability contract: `ProviderAdapter` interface, `Message`, `ContentPart`, `Request`, `Response`, `StreamEvent`, `Usage`, error class hierarchy, and all supporting types. No implementation logic. Changes here require explicit versioning.

**Layer 2 (utils/)** provides shared infrastructure for building adapters: a `fetch()` wrapper with timeout and abort support, an SSE stream adapter wrapping `eventsource-parser`, retry logic with exponential backoff and jitter, HTTP status-to-error-class mapping, and JSON Schema translation helpers. Provider adapter authors import this layer; application code generally does not.

**Layer 3 (client/)** is the `Client` class — holds registered adapters, routes requests by provider name, applies middleware in onion order, and manages configuration. `Client.fromEnv()` reads standard environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) and registers only providers whose keys are present.

**Layer 4 (api/)** provides `generate()`, `stream()`, `generateObject()`, and `streamObject()` convenience functions. These wrap the Client with tool execution loops, automatic retries, prompt standardization, structured output parsing, and abort signal propagation. A lazily-initialized module-level default client serves these functions unless an explicit client is passed.

### Package Exports

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./types": "./dist/types/index.js",
    "./client": "./dist/client/client.js",
    "./openai": "./dist/providers/openai/index.js",
    "./anthropic": "./dist/providers/anthropic/index.js",
    "./gemini": "./dist/providers/gemini/index.js",
    "./openai-compatible": "./dist/providers/openai-compatible/index.js"
  }
}
```

Most consumers import from the root. Provider-specific subpaths exist for advanced use (constructing adapters directly, accessing provider-specific types).

### Core Contracts

**ProviderAdapter interface:**

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

**Middleware type:**

```typescript
type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response> | AsyncIterable<StreamEvent>
) => Promise<Response> | AsyncIterable<StreamEvent>;
```

A single function handles both blocking and streaming modes. The Client tracks which mode was invoked and passes a typed `next`. Middleware authors check the return type to determine mode. Execution follows onion order: registration order for request phase, reverse for response phase.

**Client class:**

```typescript
class Client {
  static fromEnv(): Client;
  constructor(options: {
    providers: Record<string, ProviderAdapter>;
    defaultProvider?: string;
    middleware?: Middleware[];
  });
  complete(request: Request): Promise<Response>;
  stream(request: Request): AsyncIterable<StreamEvent>;
  close(): Promise<void>;
}
```

### Data Flow

**Blocking path (`complete`):**
1. Layer 4 `generate()` standardizes prompt/messages, enters tool loop
2. Layer 3 `Client.complete()` resolves provider, applies middleware chain
3. Provider adapter translates unified `Request` → native API JSON body
4. Layer 2 `http.ts` sends fetch with timeout/abort, receives JSON response
5. Provider adapter translates native response → unified `Response`
6. Layer 2 `error-mapping.ts` translates non-2xx status → error hierarchy class
7. Layer 4 checks for tool calls, executes via `Promise.allSettled()`, loops

**Streaming path (`stream`):**
1. Layer 4 `stream()` enters tool loop
2. Layer 3 `Client.stream()` resolves provider, applies middleware chain
3. Provider adapter translates request, sends fetch with `Accept: text/event-stream`
4. Layer 2 `sse.ts` pipes `Response.body` through `eventsource-parser`
5. Provider adapter's async generator translates SSE events → unified `StreamEvent` sequence (start/delta/end)
6. Layer 4 accumulates events, checks for tool calls at `FINISH`, executes tools, emits `step_finish`, loops

### Adapter Internal Structure

Each provider adapter follows the same file layout:

```
providers/{name}/
├── index.ts      Adapter class implementing ProviderAdapter
├── request.ts    Unified Request → native API format translation
├── response.ts   Native API response → unified Response translation
└── stream.ts     Native SSE events → unified StreamEvent translation
```

Anthropic additionally has `cache.ts` for automatic `cache_control` injection.

**Provider-specific translation highlights:**

| Concern | OpenAI (Responses API) | Anthropic (Messages API) | Gemini (Native API) | OpenAI-Compatible (Chat Completions) |
|---------|----------------------|------------------------|-------------------|-------------------------------------|
| System messages | `instructions` param | `system` param | `systemInstruction` field | `system` role in messages |
| Tool results | Top-level `function_call_output` items | `tool_result` blocks in user messages | `functionResponse` in user content | `tool` role messages |
| Tool call IDs | Provider-assigned | Provider-assigned | Synthetic UUIDs (adapter-generated) | Provider-assigned |
| Streaming | SSE with typed events | SSE with block-based events | SSE via `?alt=sse` | SSE with `data: [DONE]` |
| Auth | `Authorization: Bearer` header | `x-api-key` header | `key` query param | `Authorization: Bearer` header |
| Structured output | Native `json_schema` response format | Tool-based extraction (synthetic tool) | Native `responseSchema` | Native `json_schema` if supported |

### Anthropic Prompt Caching

The Anthropic adapter auto-injects `cache_control: { type: "ephemeral" }` breakpoints on:
1. System prompt content blocks
2. Tool definitions (if present)
3. The last user message in the conversation prefix

This is transparent to callers. The adapter also auto-includes the `prompt-caching-2024-07-31` beta header when cache_control annotations are present. Callers can disable via `providerOptions.anthropic.autoCache = false`.

### Structured Output Strategy

`generateObject()` and `streamObject()` handle Anthropic's lack of native JSON schema mode via tool-based extraction: define a synthetic tool whose `parameters` schema matches the desired output, force the model to call it via `toolChoice: { mode: "named", toolName: "__extract" }`, and parse the tool call arguments as the structured output.

For `streamObject()`, text deltas are accumulated into a growing JSON string. After each delta, `partial-json`'s `parse()` attempts repair of the incomplete JSON. If repair produces a new valid partial object, it is yielded. Final output undergoes full `JSON.parse()` + schema validation.

### Error Handling & Retry

Error hierarchy is class-based, rooted at `SDKError extends Error`. `ProviderError` subclasses carry `retryable`, `retryAfter`, `statusCode`, `raw` fields. Layer 2's `error-mapping.ts` maps HTTP status codes to the correct class, with message-based classification for ambiguous cases.

Retry logic lives in Layer 2 (`retry.ts`) and is applied by Layer 4. Low-level `Client.complete()` and `Client.stream()` never retry. Retry applies per-step (not the whole multi-step operation). Streaming does not retry after partial data delivery. Exponential backoff with jitter, respecting `Retry-After` headers up to `maxDelay`.

### External Dependencies

Two micro-dependencies:
- `eventsource-parser` (~1.5KB) — SSE parsing, used by all streaming adapters via Layer 2
- `partial-json` (~2KB) — incremental JSON repair for `streamObject()`

All other functionality is hand-rolled using native `fetch()`, `ReadableStream`, `AbortController`, and `crypto.randomUUID()`.

## Existing Patterns

This is a greenfield project — the Attractor repository contains only NLSpec documents and no existing implementation code. No codebase patterns to follow or diverge from.

The design draws architectural inspiration from:
- **Vercel AI SDK**: Provider adapter pattern with `doGenerate`/`doStream`, middleware with separate wrapping for blocking and streaming, start/delta/end streaming event pattern
- **LiteLLM**: Model string routing pattern, unified calling convention
- **pi-ai**: Cost tracking via Usage aggregation, clean provider adapter pattern

These are reference architectures, not dependencies.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Project Scaffolding & Core Types

**Goal:** Initialize the project structure, build tooling, and define all Layer 1 types.

**Components:**
- `packages/llm/package.json` — package config with ESM, subpath exports, dependencies (eventsource-parser, partial-json), dev dependencies (typescript, tsup, vitest)
- `packages/llm/tsconfig.json` — strict TypeScript config targeting ES2022/NodeNext
- `packages/llm/tsup.config.ts` — build config for ESM output with declaration files
- `packages/llm/vitest.config.ts` — test config
- `packages/llm/src/types/` — all Layer 1 types: Message (with static factories), Role, ContentPart, ContentKind, ImageData, AudioData, DocumentData, ToolCallData, ToolResultData, ThinkingData, Request, Response, FinishReason, Usage (with `.add()`), RateLimitInfo, Warning, StreamEvent, StreamEventType, Tool, ToolCall, ToolResult, ToolChoice, ResponseFormat, TimeoutConfig, RetryPolicy
- `packages/llm/src/types/error.ts` — full error class hierarchy (SDKError through all ProviderError subclasses)
- `packages/llm/src/types/provider.ts` — ProviderAdapter interface

**Dependencies:** None (first phase)

**Done when:** `npm install` succeeds, `npm run build` produces `dist/` with declaration files, `npm test` runs (no tests yet). All types compile and export correctly from `@attractor/llm/types`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Provider Utilities (Layer 2)

**Goal:** Build the shared infrastructure that all provider adapters depend on.

**Components:**
- `packages/llm/src/utils/http.ts` — fetch wrapper with timeout (connect, request, stream_read), abort signal propagation, default headers, JSON body serialization, non-2xx detection
- `packages/llm/src/utils/sse.ts` — wraps `eventsource-parser` to produce `AsyncIterable<SSEEvent>` from a fetch `Response.body` ReadableStream
- `packages/llm/src/utils/retry.ts` — `RetryPolicy` implementation with exponential backoff, jitter, `Retry-After` header respect, `maxDelay` cap, `onRetry` callback. Standalone `retry()` utility function
- `packages/llm/src/utils/error-mapping.ts` — HTTP status code → error class mapping table, message-based classification for ambiguous cases, `Retry-After` header extraction
- `packages/llm/src/utils/json-schema.ts` — JSON Schema helpers for tool parameter validation

**Dependencies:** Phase 1 (types)

**Done when:** Unit tests verify: fetch wrapper handles timeout/abort/error scenarios, SSE adapter correctly parses multi-line data and event types from mocked streams, retry logic follows correct backoff curve with jitter, error mapping produces correct error classes for all status codes in the spec's table.

**Acceptance criteria covered:** unified-llm-sdk.AC6 (error mapping), unified-llm-sdk.AC7 (retry)
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Core Client & Middleware (Layer 3)

**Goal:** Build the Client class with provider routing, middleware chain, and environment-based configuration.

**Components:**
- `packages/llm/src/client/client.ts` — Client class: constructor, `fromEnv()`, `complete()`, `stream()`, `close()`. Provider routing by `request.provider` field with `defaultProvider` fallback. Middleware chain builder (onion model)
- `packages/llm/src/client/middleware.ts` — Middleware type definition, chain execution logic for both blocking and streaming modes
- `packages/llm/src/client/config.ts` — Environment variable reading, provider auto-detection, configuration validation

**Dependencies:** Phase 1 (types), Phase 2 (utils — Client uses error classes)

**Done when:** Unit tests verify: Client routes to correct adapter by provider name, default provider is used when provider omitted, `ConfigurationError` thrown when no provider configured, middleware executes in correct order (registration for request, reverse for response), middleware works for both complete() and stream() modes, `fromEnv()` reads standard env vars and registers only present providers.

**Acceptance criteria covered:** unified-llm-sdk.AC1 (client setup), unified-llm-sdk.AC2 (middleware)
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Provider Adapters

**Goal:** Implement all four provider adapters with full request/response/streaming translation.

**Components:**
- `packages/llm/src/providers/openai/` — OpenAI adapter targeting Responses API (`/v1/responses`). Request translation (system → instructions, messages → input items, tool calls as top-level items). Response translation (content parts, finish reason, usage with reasoning_tokens). Streaming translation (response.output_text.delta → TEXT_DELTA, etc.)
- `packages/llm/src/providers/anthropic/` — Anthropic adapter targeting Messages API (`/v1/messages`). Request translation (system extraction, strict alternation merging, max_tokens default, thinking block round-tripping). Response translation (content blocks → ContentParts, end_turn → stop). Streaming (content_block_start/delta/stop → start/delta/end). `cache.ts` for auto cache_control injection and beta header management
- `packages/llm/src/providers/gemini/` — Gemini adapter targeting native API (`/v1beta/models/*/generateContent`). Request translation (system → systemInstruction, assistant → model role, synthetic tool call UUIDs). Response translation (parts → ContentParts, finish reason inference). Streaming via `?alt=sse`
- `packages/llm/src/providers/openai-compatible/` — Chat Completions adapter for third-party endpoints (`/v1/chat/completions`). Standard message format, `data: [DONE]` stream termination. No reasoning token support
- `packages/llm/src/catalog/models.ts` — Model catalog data (JSON-like structure with ModelInfo records)
- `packages/llm/src/catalog/lookup.ts` — `getModelInfo()`, `listModels()`, `getLatestModel()` functions

**Dependencies:** Phase 2 (utils — adapters use http.ts, sse.ts, error-mapping.ts)

**Done when:** Unit tests (mocked fetch) verify for each adapter: request body matches provider's expected format, response is correctly translated to unified types, streaming events follow start/delta/end pattern, all 5 roles translate correctly, tool calls and results round-trip, error responses map to correct error classes, provider-specific quirks handled (Anthropic alternation, Gemini synthetic IDs, etc.). Anthropic cache injection tests verify breakpoints placed on system/tools/last-user-message. Model catalog lookup returns correct data.

**Acceptance criteria covered:** unified-llm-sdk.AC3 (providers), unified-llm-sdk.AC4 (message model), unified-llm-sdk.AC8 (caching), unified-llm-sdk.AC9 (reasoning tokens)
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: High-Level API — generate() and stream()

**Goal:** Implement the primary generation functions with tool execution loops, retries, and cancellation.

**Components:**
- `packages/llm/src/api/generate.ts` — `generate()` function: prompt standardization (prompt vs messages, error on both), system message prepending, tool loop with `Promise.allSettled()` for parallel execution, `maxToolRounds` enforcement, `stopWhen` condition, `StepResult` tracking, `GenerateResult` with aggregated `totalUsage`, retry wrapper per step, abort signal propagation
- `packages/llm/src/api/stream.ts` — `stream()` function: same tool loop logic but streaming, `StreamResult` with async iteration, `.response()`, `.textStream`, `stepFinish` synthetic events between steps, `StreamAccumulator` utility
- `packages/llm/src/api/default-client.ts` — Module-level default client: `getDefaultClient()`, `setDefaultClient()`, lazy init from env

**Dependencies:** Phase 3 (Client), Phase 4 (adapters for integration)

**Done when:** Unit tests verify: generate() works with prompt string, generate() works with messages list, generate() rejects both prompt+messages, tool loop executes active tools and feeds results back, max_tool_rounds stops the loop, parallel tool calls executed concurrently (all results sent in one continuation), failed tools produce is_error results (not exceptions), stream() yields correct TEXT_DELTA events, stream accumulator produces equivalent response to complete(), abort signal cancels in-flight requests, retry applies per-step, default client lazy-initializes from env.

**Acceptance criteria covered:** unified-llm-sdk.AC5 (generation), unified-llm-sdk.AC10 (tool calling)
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Structured Output — generateObject() and streamObject()

**Goal:** Implement structured output generation with per-provider strategy and incremental parsing.

**Components:**
- `packages/llm/src/api/generate-object.ts` — `generateObject()`: dispatches to provider-specific strategy (OpenAI/Gemini native json_schema, Anthropic tool-based extraction), schema validation of result, `NoObjectGeneratedError` on failure
- `packages/llm/src/api/stream-object.ts` — `streamObject()`: same provider strategy, accumulates text deltas, runs `partial-json` parse after each delta, yields valid partial objects, final validation

**Dependencies:** Phase 5 (generate/stream for the underlying calls)

**Done when:** Unit tests verify: generateObject() returns parsed validated output for each provider strategy, generateObject() raises NoObjectGeneratedError on invalid output, Anthropic tool-based extraction correctly defines synthetic tool and parses arguments, streamObject() yields progressively larger partial objects, streamObject() final object matches schema.

**Acceptance criteria covered:** unified-llm-sdk.AC11 (structured output)
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Cross-Provider Integration Tests

**Goal:** Validate the full stack against real provider APIs using the spec's parity matrix and smoke test.

**Components:**
- `packages/llm/tests/integration/parity-matrix.test.ts` — Cross-provider parity matrix from spec Section 8.9: simple generation, streaming, image input (base64 + URL), single tool call, parallel tool calls, multi-step tool loop, streaming with tools, structured output, reasoning/thinking tokens, error handling (invalid key → 401, rate limit → 429), usage accuracy, prompt caching verification, provider_options passthrough
- `packages/llm/tests/integration/smoke.test.ts` — End-to-end smoke test from spec Section 8.10: basic generation across all providers, streaming verification, tool calling with parallel execution, image input, structured output, error handling
- `packages/llm/tests/integration/caching.test.ts` — Multi-turn Anthropic caching verification: turn 1 sends large system prompt, turn 2+ asserts `cache_read_tokens > 0`

**Dependencies:** Phase 6 (all features implemented)

**Done when:** All integration tests pass against real APIs with valid keys. Cross-provider parity matrix shows all cells checked. Anthropic caching test shows significant cache_read_tokens on turn 2+.

**Acceptance criteria covered:** unified-llm-sdk.AC12 (cross-provider parity), unified-llm-sdk.AC13 (integration smoke test)
<!-- END_PHASE_7 -->

## Additional Considerations

**Anthropic message alternation:** The adapter merges consecutive same-role messages by combining their content arrays. This is necessary because tool result messages (TOOL role) are translated to user-role messages, which may create consecutive user messages. The merge happens transparently during request translation.

**Gemini tool call ID mapping:** The adapter maintains a per-request `Map<string, string>` mapping synthetic UUIDs to function names. When tool results are sent back, the adapter looks up the function name from the synthetic ID to construct the correct `functionResponse` format. The map is discarded after each complete()/stream() call.

**Implementation scoping:** This design has 7 phases. All fit within the 8-phase limit for a single implementation plan.
