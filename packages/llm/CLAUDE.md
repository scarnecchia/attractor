# @attractor/llm

> Unified LLM SDK -- provider-agnostic interface for OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints.

Freshness: 2026-02-15

## Purpose

This package provides a single TypeScript API surface for interacting with multiple LLM providers. It normalises request/response formats across providers so consumers write provider-agnostic code while retaining access to provider-specific features via `providerOptions`.

## Architecture

4-layer architecture. Each layer depends only on layers below it:

```
api        (generate, stream, generateObject, streamObject)
  |
client     (Client class, middleware, env config, default client)
  |
catalog    (model catalog, lookup helpers)
  |
types      (all shared types, error hierarchy)
utils      (http, sse, retry, error-mapping, json-schema, image)
```

Package entry: `src/index.ts` re-exports types, client, catalog, and api layers.

### Subpath Exports

`package.json` exposes subpath imports for tree-shaking:
- `.` -- everything
- `./types` -- type-only imports
- `./client` -- Client class directly
- `./openai`, `./anthropic`, `./gemini`, `./openai-compatible` -- individual adapters

## Contracts

### ProviderAdapter Interface

Every provider adapter implements this interface (`src/types/provider.ts`):

```typescript
interface ProviderAdapter {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<StreamEvent>;
  close?(): Promise<void>;
  initialize?(): Promise<void>;
  supportsToolChoice?(mode: string): boolean;
}
```

### LLMRequest

Canonical request format (`src/types/request.ts`). All fields except `model` are optional:

- `model` (required), `provider`, `messages`, `prompt`, `system`
- `tools`, `toolChoice`, `maxTokens`, `temperature`, `topP`, `stopSequences`
- `responseFormat`, `timeout`, `signal`, `maxToolRounds`
- `reasoningEffort` -- `'low' | 'medium' | 'high'` (maps to provider-specific thinking/reasoning config)
- `providerOptions` -- `Record<string, Record<string, unknown>>` for provider-specific passthrough

`prompt` and `messages` are mutually exclusive (ValidationError if both set).

### LLMResponse

Canonical response format (`src/types/response.ts`):

- `id`, `model`, `content: ReadonlyArray<ContentPart>`
- `finishReason`: `'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'`
- `usage`: `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens }`
- `rateLimitInfo`, `warnings`, `steps`, `providerMetadata`

### Response Utility Functions

Convenience extractors exported from `src/types/response.ts`:
- `responseText(response)` -- concatenates all TEXT content parts
- `responseToolCalls(response)` -- extracts TOOL_CALL parts as `{ toolCallId, toolName, args }[]`
- `responseReasoning(response)` -- concatenates all THINKING content parts

### ContentPart Discriminated Union

Discriminant field: `kind`. Values: `TEXT`, `IMAGE`, `AUDIO`, `DOCUMENT`, `TOOL_CALL`, `TOOL_RESULT`, `THINKING`, `REDACTED_THINKING`.

### StreamEvent Discriminated Union

Discriminant field: `type`. Values: `STREAM_START`, `TEXT_DELTA`, `TOOL_CALL_START`, `TOOL_CALL_DELTA`, `TOOL_CALL_END`, `THINKING_DELTA`, `STEP_FINISH`, `FINISH`.

### Error Hierarchy

Base class: `SDKError extends Error`. All errors have `name` and optional `cause`.

SDK errors (non-retryable by default):
- `ConfigurationError`, `ValidationError`, `AbortError`, `RequestTimeoutError`
- `NoObjectGeneratedError` (has `.raw`), `NetworkError`, `StreamError`, `InvalidToolCallError`

Provider errors (`ProviderError extends SDKError`, has `statusCode`, `retryable`, `retryAfter`, `provider`, `errorCode`, `raw`):
- `AuthenticationError` (401), `AccessDeniedError` (403), `NotFoundError` (404)
- `InvalidRequestError` (400/422), `ContextLengthError`, `ContentFilterError`
- `RateLimitError` (retryable), `QuotaExceededError`, `ServerError` (retryable)

### Tool System

- `Tool`: `{ name, description, parameters (JSON Schema), execute? }` -- if `execute` is present, it's an "active" tool that auto-executes
- `ToolChoice`: discriminated union on `mode`: `'auto' | 'none' | 'required' | { mode: 'named', toolName }`
- `ToolCall`, `ToolResult`: standard call/result pairs with `toolCallId`

### Middleware

Onion model. Type: `(request, next) => Promise<LLMResponse> | AsyncIterable<StreamEvent>`. First-registered middleware executes first for requests, last for responses.

## Public API Functions

### `generate(options: GenerateOptions): Promise<GenerateResult>`

Blocking completion with automatic tool execution loop. Returns `{ response, steps, totalUsage, text, toolCalls }`. Retries with default retry policy. Max tool rounds default: 10.

### `stream(options: StreamOptions): StreamResult`

Streaming with tool execution loop. Returns `{ stream, textStream, response() }`. `stream` and `textStream` consume the same generator -- use one or the other. `response()` returns accumulated response after stream completes.

### `generateObject<T>(options): Promise<GenerateObjectResult<T>>`

Structured output. Strategy varies by provider:
- OpenAI/OpenAI-compatible: native `json_schema` responseFormat
- Gemini: `responseSchema` via providerOptions
- Anthropic: tool-based extraction using `__extract` tool with `toolChoice: named`

### `streamObject<T>(options): StreamObjectResult<T>`

Streaming structured output with incremental partial-json parsing. Returns `{ stream: AsyncIterable<Partial<T>>, object(): Promise<T> }`.

## Provider Adapters

All adapters follow the same pattern: constructor takes `(apiKey, options?)`, implements `complete()` and `stream()` using raw HTTP via `fetchWithTimeout`/`fetchStream`. No official SDKs used.

| Adapter | Class | API | Notes |
|---------|-------|-----|-------|
| OpenAI | `OpenAIAdapter` | Responses API | `src/providers/openai/` |
| Anthropic | `AnthropicAdapter` | Messages API | Has cache_control auto-injection (`cache.ts`) |
| Gemini | `GeminiAdapter` | Native generateContent | Uses toolCallIdMap for ID mapping |
| OpenAI-compatible | `OpenAICompatibleAdapter` | Chat Completions | Configurable `name` and `baseUrl` |

## Client

`Client` class (`src/client/client.ts`):
- Constructor takes `ClientConfig: { providers, defaultProvider?, middleware? }`
- `Client.fromEnv(adapterFactories?)` -- detects providers from env vars
- `complete(request)` and `stream(request)` route to the correct adapter
- `resolveProviderName(request)` -- public method for checking provider routing
- `close()` -- calls close on all adapters

Default client (`src/client/default-client.ts`): lazy singleton via `getDefaultClient()`, overridable with `setDefaultClient()`, resettable with `resetDefaultClient()`.

### Environment Variables

Detected by `detectProviders()` in `src/client/config.ts`:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- `OPENAI_BASE_URL`, `OPENAI_ORG_ID`

## Model Catalog

`src/catalog/models.ts` -- static catalog of known models with metadata (context window, costs, capability flags). Lookup functions in `src/catalog/lookup.ts`:
- `getModelInfo(modelId)` -- exact ID match
- `listModels(provider?)` -- filter by provider
- `getLatestModel(provider, tier?)` -- tier: `'flagship' | 'fast' | 'mini'`

## Dependencies

Runtime (2 only):
- `eventsource-parser` ^3.0.6 -- SSE stream parsing
- `partial-json` ^0.1.7 -- incremental JSON repair for streamObject

Dev:
- TypeScript ^5.7, tsup ^8.5, Vitest ^4.0, @types/node ^25.2

## Invariants

- All type fields use `readonly` -- types are immutable value objects
- ESM-only (`"type": "module"`)
- Node >= 20.0.0 (native fetch required)
- No official provider SDKs -- all HTTP calls go through `src/utils/http.ts`
- Provider adapters are stateless (no connection pooling, no session state)
- `prompt` and `messages` on a request are mutually exclusive
- Tool execution only runs for tools with an `execute` function (active tools)
- Retry policy applies to `generate()` and `stream()` API functions, not to raw `client.complete()`/`client.stream()`

## Testing

- Unit tests colocated: `src/**/*.test.ts`
- Integration tests: `tests/integration/` (smoke, parity-matrix, caching)
- Run: `npm test` (unit), `npm run test:integration` (integration, 30s timeout)
- Build: `npm run build` (tsup)
- Typecheck: `npm run typecheck`
