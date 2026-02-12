# Unified LLM SDK Implementation Plan — Phase 4

**Goal:** Implement all four provider adapters with full request/response/streaming translation, plus the model catalog.

**Architecture:** Each adapter lives in `providers/{name}/` with index.ts, request.ts, response.ts, stream.ts. Anthropic adds cache.ts. Adapters implement the `ProviderAdapter` interface and use Layer 2 utils for HTTP, SSE, and error mapping.

**Tech Stack:** TypeScript 5.7, Vitest 4.0, eventsource-parser 3.0

**Scope:** 7 phases from original design (phases 1-7). This is Phase 4.

**Codebase verified:** 2026-02-10. Phases 1-3 create types/, utils/, client/. No providers/ or catalog/ directory exists yet.

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

### unified-llm-sdk.AC8: Prompt Caching
- **unified-llm-sdk.AC8.1 Success:** Anthropic adapter auto-injects cache_control on system, tools, last user message
- **unified-llm-sdk.AC8.2 Success:** Anthropic adapter auto-includes prompt-caching beta header
- **unified-llm-sdk.AC8.3 Success:** Auto-caching disabled via providerOptions.anthropic.autoCache=false
- **unified-llm-sdk.AC8.4 Success:** Usage.cacheReadTokens populated for all three providers
- **unified-llm-sdk.AC8.5 Success:** Usage.cacheWriteTokens populated for Anthropic

### unified-llm-sdk.AC9: Reasoning Tokens
- **unified-llm-sdk.AC9.1 Success:** OpenAI reasoning_tokens in Usage via Responses API
- **unified-llm-sdk.AC9.2 Success:** reasoning_effort parameter passed through to OpenAI
- **unified-llm-sdk.AC9.3 Success:** Anthropic thinking blocks returned as THINKING content parts
- **unified-llm-sdk.AC9.4 Success:** Thinking block signatures preserved for round-tripping
- **unified-llm-sdk.AC9.5 Success:** Gemini thoughtsTokenCount mapped to reasoning_tokens

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: OpenAI adapter — request translation

**Files:**
- Create: `packages/llm/src/providers/openai/request.ts`

**Implementation:**

Create the request translator for OpenAI's Responses API (`POST /v1/responses`).

Function `translateRequest(request: Request, apiKey: string): { url: string; headers: Record<string, string>; body: Record<string, unknown> }`:

- **URL:** `https://api.openai.com/v1/responses`
- **Headers:** `{ 'Authorization': 'Bearer ${apiKey}', 'Content-Type': 'application/json' }`
- **Body mapping:**
  - `request.model` → `body.model`
  - `request.system` → `body.instructions`
  - `request.messages` → `body.input` (array of input items):
    - User text message → `{ type: 'message', role: 'user', content: text }`
    - User multimodal → `{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: url }] }`
    - Assistant text → `{ type: 'message', role: 'assistant', content: text }`
    - Tool result → `{ type: 'function_call_output', call_id: toolCallId, output: content }`
  - `request.tools` → `body.tools` (each as `{ type: 'function', function: { name, description, parameters } }`)
  - `request.toolChoice` → `body.tool_choice`: auto→`'auto'`, none→`'none'`, required→`'required'`, named→`{ type: 'function', function: { name } }`
  - `request.maxTokens` → `body.max_output_tokens`
  - `request.temperature` → `body.temperature`
  - `request.topP` → `body.top_p`
  - `request.stopSequences` → `body.stop`
  - `request.providerOptions?.openai` → spread into body (escape hatch, AC3.6)
  - Image base64 → `{ type: 'input_image', image_url: 'data:${mediaType};base64,${data}' }`
  - Image URL → `{ type: 'input_image', image_url: url }`

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add OpenAI Responses API request translator`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: OpenAI adapter — response and stream translation

**Files:**
- Create: `packages/llm/src/providers/openai/response.ts`
- Create: `packages/llm/src/providers/openai/stream.ts`

**Implementation:**

**response.ts** — `translateResponse(raw: Record<string, unknown>): Response`:

- `raw.id` → `response.id`
- `raw.model` → `response.model` (may differ from requested model)
- `raw.output` → `response.content`: iterate output items:
  - `{ type: 'message' }` → extract text content as `TextData` parts
  - `{ type: 'function_call' }` → `ToolCallData` with `toolCallId = item.call_id`, `toolName = item.name`, `args = item.arguments` (already an object)
- `raw.usage` → `response.usage`: map `input_tokens`, `output_tokens`, and if present `reasoning_tokens` to `reasoningTokens` (AC9.1). Also map `prompt_tokens_details.cached_tokens` → `cacheReadTokens` (AC8.4) when present.
- Finish reason: `raw.stop_reason` → map `'stop'`→`'stop'`, `'length'`→`'length'`, `'tool_calls'`→`'tool_calls'`, `'content_filter'`→`'content_filter'`

**stream.ts** — `async function* translateStream(sseStream: AsyncIterable<SSEEvent>): AsyncIterable<StreamEvent>`:

- Parse each SSE event's `data` as JSON
- Map to unified StreamEvent types:
  - `response.created` / first event → yield `STREAM_START` with id and model
  - `response.output_text.delta` → yield `TEXT_DELTA`
  - `response.function_call_arguments.delta` → yield `TOOL_CALL_DELTA`
  - `response.completed` → yield `FINISH` with usage and finish reason
- Track tool call state: emit `TOOL_CALL_START` when a new function_call output begins, `TOOL_CALL_END` when it completes

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add OpenAI response and stream translators`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: OpenAI adapter — index and tests

**Verifies:** unified-llm-sdk.AC3.1, unified-llm-sdk.AC3.5 (openai), unified-llm-sdk.AC3.6 (openai), unified-llm-sdk.AC4.1 (openai), unified-llm-sdk.AC4.2 (openai), unified-llm-sdk.AC4.3 (openai), unified-llm-sdk.AC4.5 (openai), unified-llm-sdk.AC9.1, unified-llm-sdk.AC9.2

**Files:**
- Create: `packages/llm/src/providers/openai/index.ts`
- Create: `packages/llm/src/providers/openai/openai.test.ts`

**Implementation (index.ts):**

`OpenAIAdapter` class implementing `ProviderAdapter`:
- Constructor: `(apiKey: string, options?: { baseUrl?: string })`
- `name`: `'openai'`
- `complete(request)`: Call `translateRequest()`, use `fetchWithTimeout()` from utils, call `translateResponse()` on result
- `stream(request)`: Same but with `stream: true` in body, use `fetchStream()` → `createSSEStream()` → `translateStream()`
- Pass `request.signal` and `request.timeout` through to fetch

**Testing (openai.test.ts):**

Mock `globalThis.fetch` to capture requests and return canned responses.

Tests:
- unified-llm-sdk.AC3.1: Request URL is `/v1/responses` (not `/v1/chat/completions`)
- unified-llm-sdk.AC3.5: System message maps to `instructions`, user/assistant/tool roles map correctly
- unified-llm-sdk.AC3.6: `providerOptions.openai.reasoning_effort` appears in request body
- unified-llm-sdk.AC4.1: Text-only user message → correct input item structure
- unified-llm-sdk.AC4.2: Image with base64 → `input_image` with data URI
- unified-llm-sdk.AC4.3: Image with URL → `input_image` with url
- unified-llm-sdk.AC4.5: Tool call in response parsed correctly, tool result in request translated correctly
- unified-llm-sdk.AC9.1: Response with `reasoning_tokens` in usage → mapped to `usage.reasoningTokens`
- unified-llm-sdk.AC9.2: `providerOptions.openai.reasoning_effort = 'high'` → appears in request body
- unified-llm-sdk.AC8.4: Response with `usage.prompt_tokens_details.cached_tokens` → mapped to `usage.cacheReadTokens`
- **Stream test:** Mock SSE events → yields correct sequence of StreamEvent types (STREAM_START, TEXT_DELTA, FINISH)

**Verification:**

```bash
cd packages/llm && npm test -- src/providers/openai/openai.test.ts
```

**Commit:** `feat: add OpenAI adapter with Responses API support`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-7) -->
<!-- START_TASK_4 -->
### Task 4: Anthropic adapter — cache injection

**Files:**
- Create: `packages/llm/src/providers/anthropic/cache.ts`

**Implementation:**

Create `packages/llm/src/providers/anthropic/cache.ts` with:

`injectCacheControl(body: Record<string, unknown>, autoCache: boolean): Record<string, unknown>`:

If `autoCache` is false, return body unchanged.

If `autoCache` is true, inject `cache_control: { type: 'ephemeral' }` on:
1. **System prompt:** On the last content block of the system array
2. **Tools:** On the last tool definition in the tools array (add `cache_control` at the tool level)
3. **Last user message:** On the last content block of the last user message in the messages array

Return the modified body. Do not mutate the input — create new objects.

Also export `injectBetaHeaders(headers: Record<string, string>, hasCacheControl: boolean): Record<string, string>`:
- If `hasCacheControl` is true, add `anthropic-beta: prompt-caching-2024-07-31` to headers (comma-append if `anthropic-beta` already exists from provider_options)

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add Anthropic cache_control auto-injection`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Anthropic adapter — request translation

**Files:**
- Create: `packages/llm/src/providers/anthropic/request.ts`

**Implementation:**

Function `translateRequest(request: Request, apiKey: string): { url: string; headers: Record<string, string>; body: Record<string, unknown> }`:

- **URL:** `https://api.anthropic.com/v1/messages`
- **Headers:** `{ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }` (AC3.2)
  - Merge any beta headers from `providerOptions.anthropic.betaHeaders` (AC3.7)
- **Body mapping:**
  - `request.model` → `body.model`
  - `request.system` → `body.system` as array of content blocks: `[{ type: 'text', text: systemText }]`
  - `request.messages` → `body.messages` with strict alternation enforcement:
    - User text → `{ role: 'user', content: [{ type: 'text', text }] }`
    - Assistant text → `{ role: 'assistant', content: [{ type: 'text', text }] }`
    - Tool result → `{ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCallId, content: text }] }`
    - **Merge consecutive same-role messages:** If two user messages would be adjacent (e.g., user text followed by tool result), combine their content arrays into a single message
    - Thinking blocks (assistant) → `{ type: 'thinking', thinking: text, signature: sig }` in assistant content (AC4.6, AC9.4)
    - Redacted thinking → `{ type: 'redacted_thinking', data: base64data }` in assistant content (AC4.7)
  - `request.tools` → `body.tools` (each as `{ name, description, input_schema: parameters }`)
  - `request.toolChoice` → `body.tool_choice`: auto→`{ type: 'auto' }`, none→not set, required→`{ type: 'any' }`, named→`{ type: 'tool', name: toolName }`
  - `request.maxTokens` → `body.max_tokens` (default to 4096 if not specified — Anthropic requires this field)
  - `request.temperature` → `body.temperature`
  - `request.topP` → `body.top_p`
  - `request.stopSequences` → `body.stop_sequences`
  - `request.providerOptions?.anthropic` → spread into body (AC3.6), except reserved keys (betaHeaders, autoCache)
  - Image base64 → `{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64data } }`
  - Image URL → `{ type: 'image', source: { type: 'url', url: imageUrl } }`
  - Apply cache injection via `injectCacheControl()` (default `autoCache = true` unless `providerOptions.anthropic.autoCache === false`, AC8.3)
  - Apply beta headers via `injectBetaHeaders()`

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add Anthropic Messages API request translator`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Anthropic adapter — response and stream translation

**Files:**
- Create: `packages/llm/src/providers/anthropic/response.ts`
- Create: `packages/llm/src/providers/anthropic/stream.ts`

**Implementation:**

**response.ts** — `translateResponse(raw: Record<string, unknown>): Response`:

- `raw.id` → `response.id`
- `raw.model` → `response.model`
- `raw.content` → `response.content`: iterate content blocks:
  - `{ type: 'text' }` → `TextData`
  - `{ type: 'tool_use' }` → `ToolCallData` with `toolCallId = block.id`, `toolName = block.name`, `args = block.input`
  - `{ type: 'thinking' }` → `ThinkingData` with `text = block.thinking`, `signature = block.signature` (AC9.3, AC9.4)
  - `{ type: 'redacted_thinking' }` → `RedactedThinkingData` with `data = block.data` (AC4.7)
- `raw.usage` → `response.usage`:
  - `input_tokens` → `inputTokens`
  - `output_tokens` → `outputTokens`
  - `cache_creation_input_tokens` → `cacheWriteTokens` (AC8.5)
  - `cache_read_input_tokens` → `cacheReadTokens` (AC8.4)
- `raw.stop_reason` → finish reason: `'end_turn'`→`'stop'`, `'max_tokens'`→`'length'`, `'tool_use'`→`'tool_calls'`

**stream.ts** — `async function* translateStream(sseStream: AsyncIterable<SSEEvent>): AsyncIterable<StreamEvent>`:

- `message_start` → yield `STREAM_START` with id and model from `message` object
- `content_block_start` with `type: 'text'` → no event (wait for deltas)
- `content_block_start` with `type: 'tool_use'` → yield `TOOL_CALL_START` with toolCallId and toolName
- `content_block_start` with `type: 'thinking'` → no event (wait for deltas)
- `content_block_delta` with `type: 'text_delta'` → yield `TEXT_DELTA`
- `content_block_delta` with `type: 'input_json_delta'` → yield `TOOL_CALL_DELTA`
- `content_block_delta` with `type: 'thinking_delta'` → yield `THINKING_DELTA`
- `content_block_stop` for tool_use block → yield `TOOL_CALL_END`
- `message_delta` → extract `stop_reason` and `usage`
- `message_stop` → yield `FINISH` with accumulated usage and finish reason

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add Anthropic response and stream translators`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Anthropic adapter — index and tests

**Verifies:** unified-llm-sdk.AC3.2, unified-llm-sdk.AC3.5 (anthropic), unified-llm-sdk.AC3.6 (anthropic), unified-llm-sdk.AC3.7, unified-llm-sdk.AC4.1 (anthropic), unified-llm-sdk.AC4.2 (anthropic), unified-llm-sdk.AC4.3 (anthropic), unified-llm-sdk.AC4.5 (anthropic), unified-llm-sdk.AC4.6, unified-llm-sdk.AC4.7, unified-llm-sdk.AC8.1, unified-llm-sdk.AC8.2, unified-llm-sdk.AC8.3, unified-llm-sdk.AC8.4, unified-llm-sdk.AC8.5, unified-llm-sdk.AC9.3, unified-llm-sdk.AC9.4

**Files:**
- Create: `packages/llm/src/providers/anthropic/index.ts`
- Create: `packages/llm/src/providers/anthropic/anthropic.test.ts`

**Implementation (index.ts):**

`AnthropicAdapter` class implementing `ProviderAdapter`:
- Constructor: `(apiKey: string, options?: { baseUrl?: string })`
- `name`: `'anthropic'`
- `complete(request)`: translateRequest → fetchWithTimeout → translateResponse
- `stream(request)`: translateRequest with `stream: true` → fetchStream → createSSEStream → translateStream

**Testing (anthropic.test.ts):**

Mock `globalThis.fetch`.

Tests:
- unified-llm-sdk.AC3.2: Request has `x-api-key` and `anthropic-version` headers
- unified-llm-sdk.AC3.5: All 5 roles translate correctly (system→body.system, user→messages, assistant→messages, tool→user with tool_result, developer→user)
- unified-llm-sdk.AC3.6: `providerOptions.anthropic.metadata` appears in request body
- unified-llm-sdk.AC3.7: `providerOptions.anthropic.betaHeaders` merged into `anthropic-beta` header
- unified-llm-sdk.AC4.1: Text-only messages → correct Anthropic format
- unified-llm-sdk.AC4.2: Image base64 → `source.type: 'base64'`
- unified-llm-sdk.AC4.3: Image URL → `source.type: 'url'`
- unified-llm-sdk.AC4.5: Tool call response parsed, tool result request formatted as `tool_result` in user message
- unified-llm-sdk.AC4.6: Thinking block in response → `ThinkingData` with signature preserved
- unified-llm-sdk.AC4.7: Redacted thinking block → `RedactedThinkingData` with data preserved
- **Message alternation:** Two consecutive user messages merged into one
- unified-llm-sdk.AC8.1: Request body has `cache_control` on system, tools, and last user message
- unified-llm-sdk.AC8.2: Request headers include `prompt-caching-2024-07-31` in `anthropic-beta`
- unified-llm-sdk.AC8.3: `providerOptions.anthropic.autoCache = false` → no cache_control injected
- unified-llm-sdk.AC8.4: Response with `cache_read_input_tokens` → `usage.cacheReadTokens`
- unified-llm-sdk.AC8.5: Response with `cache_creation_input_tokens` → `usage.cacheWriteTokens`
- unified-llm-sdk.AC9.3: Thinking content block → `THINKING` content part
- unified-llm-sdk.AC9.4: Thinking block signature round-trips (present in request translation for continuation)
- **Stream test:** Mock SSE events → yields correct StreamEvent sequence including THINKING_DELTA

**Verification:**

```bash
cd packages/llm && npm test -- src/providers/anthropic/anthropic.test.ts
```

**Commit:** `feat: add Anthropic adapter with caching and thinking support`
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 8-10) -->
<!-- START_TASK_8 -->
### Task 8: Gemini adapter — request translation

**Files:**
- Create: `packages/llm/src/providers/gemini/request.ts`

**Implementation:**

Function `translateRequest(request: Request, apiKey: string, streaming: boolean): { url: string; headers: Record<string, string>; body: Record<string, unknown> }`:

- **URL:** `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}` for blocking, `:streamGenerateContent?key=${apiKey}&alt=sse` for streaming (AC3.3)
- **Headers:** `{ 'Content-Type': 'application/json' }` (auth is via query param)
- **Body mapping:**
  - `request.system` → `body.systemInstruction: { role: 'user', parts: [{ text }] }`
  - `request.messages` → `body.contents`: array of `{ role, parts }`:
    - User → `{ role: 'user', parts: [{ text }] }`
    - Assistant → `{ role: 'model', parts: [{ text }] }` (Gemini uses 'model' not 'assistant')
    - Tool result → `{ role: 'user', parts: [{ functionResponse: { name: toolName, response: { result: content } } }] }`
      - Requires mapping toolCallId back to function name via a maintained map
    - Image base64 → `{ inlineData: { mimeType: mediaType, data: base64data } }` in parts
    - Image URL → `{ fileData: { mimeType: mediaType, fileUri: url } }` in parts
  - Audio content → not natively supported by this SDK version; log a warning and skip audio parts. Future versions may add audio support.
  - Document content → not natively supported by this SDK version; log a warning and skip document parts. Future versions may add document support.
  - `request.tools` → `body.tools: [{ function_declarations: [{ name, description, parameters }] }]`
  - `request.toolChoice` → `body.toolConfig.functionCallingConfig`: auto→`{ mode: 'AUTO' }`, none→`{ mode: 'NONE' }`, required→`{ mode: 'ANY' }`, named→`{ mode: 'ANY', allowedFunctionNames: [toolName] }`
  - `request.maxTokens` → `body.generationConfig.maxOutputTokens`
  - `request.temperature` → `body.generationConfig.temperature`
  - `request.topP` → `body.generationConfig.topP`
  - `request.stopSequences` → `body.generationConfig.stopSequences`
  - `request.providerOptions?.gemini` → spread into body (AC3.6)

Maintain a `toolCallIdMap: Map<string, string>` for mapping synthetic UUIDs to function names. This map is created per-request.

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add Gemini native API request translator`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Gemini adapter — response and stream translation

**Files:**
- Create: `packages/llm/src/providers/gemini/response.ts`
- Create: `packages/llm/src/providers/gemini/stream.ts`

**Implementation:**

**response.ts** — `translateResponse(raw: Record<string, unknown>, toolCallIdMap: Map<string, string>): Response`:

- `raw.candidates[0].content.parts` → `response.content`: iterate parts:
  - `{ text }` → `TextData`
  - `{ functionCall: { name, args } }` → `ToolCallData` with synthetic UUID (`crypto.randomUUID()`), store mapping in `toolCallIdMap` for subsequent requests
- `raw.usageMetadata` → `response.usage`:
  - `promptTokenCount` → `inputTokens`
  - `candidatesTokenCount` → `outputTokens`
  - `totalTokenCount` → `totalTokens`
  - `thoughtsTokenCount` → `reasoningTokens` (AC9.5, if present)
  - `cachedContentTokenCount` → `cacheReadTokens` (AC8.4, if present)
- `raw.candidates[0].finishReason` → map: `'STOP'`→`'stop'`, `'MAX_TOKENS'`→`'length'`, `'SAFETY'`→`'content_filter'`
- Generate `response.id` as a synthetic UUID (Gemini doesn't provide one)

**stream.ts** — `async function* translateStream(sseStream: AsyncIterable<SSEEvent>, toolCallIdMap: Map<string, string>): AsyncIterable<StreamEvent>`:

- First event → yield `STREAM_START` with synthetic id and model
- Each event's `candidates[0].content.parts`:
  - `{ text }` → yield `TEXT_DELTA`
  - `{ functionCall }` → yield `TOOL_CALL_START` then `TOOL_CALL_END` (Gemini sends function calls as complete objects in a single chunk)
- Last event (has `finishReason`) → yield `FINISH` with usage from `usageMetadata`

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add Gemini response and stream translators`
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Gemini adapter — index and tests

**Verifies:** unified-llm-sdk.AC3.3, unified-llm-sdk.AC3.5 (gemini), unified-llm-sdk.AC3.6 (gemini), unified-llm-sdk.AC4.1 (gemini), unified-llm-sdk.AC4.2 (gemini), unified-llm-sdk.AC4.3 (gemini), unified-llm-sdk.AC4.5 (gemini), unified-llm-sdk.AC9.5, unified-llm-sdk.AC8.4 (gemini)

**Files:**
- Create: `packages/llm/src/providers/gemini/index.ts`
- Create: `packages/llm/src/providers/gemini/gemini.test.ts`

**Implementation (index.ts):**

`GeminiAdapter` class implementing `ProviderAdapter`:
- Constructor: `(apiKey: string, options?: { baseUrl?: string })`
- `name`: `'gemini'`
- Maintains `toolCallIdMap: Map<string, string>` per request
- `complete(request)`: translateRequest → fetchWithTimeout → translateResponse
- `stream(request)`: translateRequest with streaming=true → fetchStream → createSSEStream → translateStream

**Testing (gemini.test.ts):**

Mock `globalThis.fetch`.

Tests:
- unified-llm-sdk.AC3.3: Streaming URL uses `:streamGenerateContent?key=...&alt=sse`
- unified-llm-sdk.AC3.3: Blocking URL uses `:generateContent?key=...`
- unified-llm-sdk.AC3.5: System→systemInstruction, user→user role, assistant→model role, tool→user with functionResponse
- unified-llm-sdk.AC3.6: `providerOptions.gemini` merged into body
- unified-llm-sdk.AC4.1: Text-only → `parts: [{ text }]`
- unified-llm-sdk.AC4.2: Image base64 → `inlineData` part
- unified-llm-sdk.AC4.3: Image URL → `fileData` part with `fileUri`
- unified-llm-sdk.AC4.5: Function call response generates synthetic UUID, tool result maps UUID back to function name
- unified-llm-sdk.AC9.5: `usageMetadata.thoughtsTokenCount` → `usage.reasoningTokens`
- unified-llm-sdk.AC8.4: `usageMetadata.cachedContentTokenCount` → `usage.cacheReadTokens`
- **Synthetic tool call IDs:** Multiple tool calls each get unique UUIDs

**Verification:**

```bash
cd packages/llm && npm test -- src/providers/gemini/gemini.test.ts
```

**Commit:** `feat: add Gemini adapter with native API support`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 11-13) -->
<!-- START_TASK_11 -->
### Task 11: OpenAI-compatible adapter — request translation

**Files:**
- Create: `packages/llm/src/providers/openai-compatible/request.ts`

**Implementation:**

Function `translateRequest(request: Request, apiKey: string, baseUrl: string): { url: string; headers: Record<string, string>; body: Record<string, unknown> }`:

- **URL:** `${baseUrl}/v1/chat/completions`
- **Headers:** `{ 'Authorization': 'Bearer ${apiKey}', 'Content-Type': 'application/json' }`
- **Body mapping (standard Chat Completions format):**
  - `request.model` → `body.model`
  - `request.messages` → `body.messages`:
    - System → `{ role: 'system', content: text }`
    - User text → `{ role: 'user', content: text }`
    - User multimodal → `{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }] }`
    - Assistant text → `{ role: 'assistant', content: text }`
    - Assistant with tool calls → `{ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }`
    - Tool result → `{ role: 'tool', tool_call_id: id, content: text }`
  - Prepend system message from `request.system` if provided
  - `request.tools` → `body.tools` (same format as OpenAI: `{ type: 'function', function: { name, description, parameters } }`)
  - `request.toolChoice` → `body.tool_choice`: auto→`'auto'`, none→`'none'`, required→`'required'`, named→`{ type: 'function', function: { name } }`
  - `request.maxTokens` → `body.max_tokens`
  - `request.temperature` → `body.temperature`
  - `request.topP` → `body.top_p`
  - `request.stopSequences` → `body.stop`
  - `request.providerOptions?.openaiCompatible` → spread into body (AC3.6)

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add OpenAI-compatible Chat Completions request translator`
<!-- END_TASK_11 -->

<!-- START_TASK_12 -->
### Task 12: OpenAI-compatible adapter — response and stream translation

**Files:**
- Create: `packages/llm/src/providers/openai-compatible/response.ts`
- Create: `packages/llm/src/providers/openai-compatible/stream.ts`

**Implementation:**

**response.ts** — `translateResponse(raw: Record<string, unknown>): Response`:

- `raw.id` → `response.id`
- `raw.model` → `response.model`
- `raw.choices[0].message.content` → `TextData` if present
- `raw.choices[0].message.tool_calls` → array of `ToolCallData`:
  - `toolCallId = tc.id`
  - `toolName = tc.function.name`
  - `args = JSON.parse(tc.function.arguments)` (arguments is a JSON string in Chat Completions)
- `raw.usage` → `response.usage`: `prompt_tokens`→`inputTokens`, `completion_tokens`→`outputTokens`, `total_tokens`→`totalTokens`
- `raw.choices[0].finish_reason` → map: `'stop'`→`'stop'`, `'length'`→`'length'`, `'tool_calls'`→`'tool_calls'`, `'content_filter'`→`'content_filter'`

**stream.ts** — `async function* translateStream(sseStream: AsyncIterable<SSEEvent>): AsyncIterable<StreamEvent>`:

- First chunk with `choices[0].delta.role === 'assistant'` → yield `STREAM_START`
- `choices[0].delta.content` (non-null) → yield `TEXT_DELTA`
- `choices[0].delta.tool_calls` → track tool call state:
  - New tool call (has `id` and `function.name`) → yield `TOOL_CALL_START`
  - Subsequent chunks with `function.arguments` → yield `TOOL_CALL_DELTA`
- `choices[0].finish_reason` (non-null) → yield tool `TOOL_CALL_END` for any open tool calls, then yield `FINISH`
- `data: [DONE]` → stop iteration (don't yield anything, this is the SSE terminator)

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add OpenAI-compatible response and stream translators`
<!-- END_TASK_12 -->

<!-- START_TASK_13 -->
### Task 13: OpenAI-compatible adapter — index and tests

**Verifies:** unified-llm-sdk.AC3.4, unified-llm-sdk.AC3.5 (openai-compatible), unified-llm-sdk.AC3.6 (openai-compatible), unified-llm-sdk.AC4.1 (openai-compatible), unified-llm-sdk.AC4.5 (openai-compatible)

**Files:**
- Create: `packages/llm/src/providers/openai-compatible/index.ts`
- Create: `packages/llm/src/providers/openai-compatible/openai-compatible.test.ts`

**Implementation (index.ts):**

`OpenAICompatibleAdapter` class implementing `ProviderAdapter`:
- Constructor: `(apiKey: string, baseUrl: string, options?: { name?: string })`
- `name`: `options.name ?? 'openai-compatible'`
- `complete(request)`: translateRequest → fetchWithTimeout → translateResponse
- `stream(request)`: translateRequest with `stream: true` → fetchStream → createSSEStream → translateStream

**Testing (openai-compatible.test.ts):**

Mock `globalThis.fetch`.

Tests:
- unified-llm-sdk.AC3.4: URL uses `/v1/chat/completions`
- unified-llm-sdk.AC3.4: Uses custom baseUrl, not OpenAI's URL
- unified-llm-sdk.AC3.5: System, user, assistant, tool roles all map correctly
- unified-llm-sdk.AC3.6: `providerOptions.openaiCompatible` merged into body
- unified-llm-sdk.AC4.1: Text-only message → correct Chat Completions format
- unified-llm-sdk.AC4.5: Tool call arguments parsed from JSON string, tool result formatted as tool role message
- **Stream test:** Mock SSE with `data: [DONE]` terminator → iteration stops cleanly
- **Custom name:** `new OpenAICompatibleAdapter(key, url, { name: 'groq' })` → `adapter.name === 'groq'`

**Verification:**

```bash
cd packages/llm && npm test -- src/providers/openai-compatible/openai-compatible.test.ts
```

**Commit:** `feat: add OpenAI-compatible adapter for third-party endpoints`
<!-- END_TASK_13 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (tasks 14-15) -->
<!-- START_TASK_14 -->
### Task 14: Model catalog

**Files:**
- Create: `packages/llm/src/catalog/models.ts`
- Create: `packages/llm/src/catalog/lookup.ts`

**Implementation:**

**models.ts:**

Define `ModelInfo` type:
```typescript
type ModelInfo = {
  readonly id: string;
  readonly provider: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly inputCostPer1kTokens: number;
  readonly outputCostPer1kTokens: number;
};
```

Define `MODEL_CATALOG: ReadonlyArray<ModelInfo>` with entries for common models:
- OpenAI: gpt-4o, gpt-4o-mini, o1, o1-mini, o3-mini
- Anthropic: claude-opus-4-6, claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001
- Gemini: gemini-2.0-flash, gemini-2.0-pro

Use realistic context window sizes and costs from provider documentation.

**lookup.ts:**

- `getModelInfo(modelId: string): ModelInfo | null` — find by exact id match
- `listModels(provider?: string): ReadonlyArray<ModelInfo>` — list all, or filter by provider
- `getLatestModel(provider: string, tier?: 'flagship' | 'fast' | 'mini'): ModelInfo | null` — return the latest/recommended model for a provider

**Verification:**

```bash
cd packages/llm && npx tsc --noEmit
```

**Commit:** `feat: add model catalog with lookup functions`
<!-- END_TASK_14 -->

<!-- START_TASK_15 -->
### Task 15: Model catalog tests

**Verifies:** None directly — infrastructure for model selection.

**Files:**
- Create: `packages/llm/src/catalog/catalog.test.ts`

**Testing:**

Tests for `getModelInfo`:
- Known model ID returns correct ModelInfo
- Unknown model ID returns null

Tests for `listModels`:
- No filter → returns all models
- Filter by 'openai' → returns only OpenAI models
- Filter by unknown provider → returns empty array

Tests for `getLatestModel`:
- 'openai' → returns a valid OpenAI model
- 'anthropic' → returns a valid Anthropic model
- Unknown provider → returns null

**Verification:**

```bash
cd packages/llm && npm test -- src/catalog/catalog.test.ts
```

**Commit:** `test: add model catalog lookup tests`
<!-- END_TASK_15 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_TASK_16 -->
### Task 16: Image file path handling

**Verifies:** unified-llm-sdk.AC4.4

**Files:**
- Create: `packages/llm/src/utils/image.ts`
- Create: `packages/llm/src/utils/image.test.ts`

**Implementation (image.ts):**

`async function resolveImageContent(content: ContentPart): Promise<ContentPart>`:

If `content.kind === 'IMAGE'` and the content has neither `data` (base64) nor `url` set but has a file path indicator (convention: a string that looks like a file path — starts with `/` or `./` or `~`), read the file, base64-encode it, detect media type from extension, and return a new `ImageData` with `data` and `mediaType` populated.

Use `fs.readFile()` from `node:fs/promises` and `Buffer.toString('base64')`.

Media type detection:
- `.png` → `image/png`
- `.jpg`, `.jpeg` → `image/jpeg`
- `.gif` → `image/gif`
- `.webp` → `image/webp`

If content already has `data` or `url`, return unchanged.

**Testing (image.test.ts):**

- unified-llm-sdk.AC4.4: Create a temp file, pass its path → returns ImageData with base64 data and correct mediaType
- Non-image ContentPart → returned unchanged
- Image with existing base64 data → returned unchanged
- Image with existing URL → returned unchanged

**Verification:**

```bash
cd packages/llm && npm test -- src/utils/image.test.ts
```

**Commit:** `feat: add image file path resolution with base64 encoding`
<!-- END_TASK_16 -->

<!-- START_TASK_17 -->
### Task 17: Provider barrel exports and full test run

**Files:**
- Create: `packages/llm/src/providers/openai/index.ts` (already done — verify export)
- Create: `packages/llm/src/providers/anthropic/index.ts` (already done — verify export)
- Create: `packages/llm/src/providers/gemini/index.ts` (already done — verify export)
- Create: `packages/llm/src/providers/openai-compatible/index.ts` (already done — verify export)
- Create: `packages/llm/src/catalog/index.ts`
- Modify: `packages/llm/src/index.ts` (add catalog re-export)
- Modify: `packages/llm/tsup.config.ts` (verify all entry points present)

**Step 1: Create catalog barrel export**

Create `packages/llm/src/catalog/index.ts` re-exporting from:
- `./models.js`
- `./lookup.js`

**Step 2: Update root barrel export**

Add to `packages/llm/src/index.ts`:
```typescript
export * from './catalog/index.js';
```

Note: Provider adapters are NOT re-exported from root — they have their own subpath exports (`@attractor/llm/openai`, etc.).

**Step 3: Run full test suite**

```bash
cd packages/llm && npm test
```

Expected: All Phase 2 + Phase 3 + Phase 4 tests pass.

**Step 4: Run build**

```bash
cd packages/llm && npm run build
```

Expected: Build succeeds with all provider and catalog entries in dist/.

**Step 5: Commit**

```bash
git add packages/llm/src/catalog/index.ts packages/llm/src/index.ts
git commit -m "feat: add catalog and provider barrel exports, verify full test suite"
```
<!-- END_TASK_17 -->
