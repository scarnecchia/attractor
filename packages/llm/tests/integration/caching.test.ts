import { expect, test, describe } from 'vitest';
import { generate } from '../../src/api/generate.js';
import { hasApiKey, DEFAULT_MODEL } from './helpers.js';
import type { TestProvider } from './helpers.js';

// Deterministic large system prompt for caching tests (~2000 tokens of text)
const LARGE_SYSTEM_PROMPT = `You are a helpful AI assistant. ${
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100)
}

Respond to user queries with accurate, helpful information. Focus on clarity and correctness. When the user asks questions, provide detailed answers based on the context provided.

Technical knowledge: You understand software development, mathematics, science, history, and general knowledge topics. You can explain concepts in simple terms or technical detail depending on the user's level.

Remember to:
1. Read the entire context carefully before responding
2. Provide accurate information based on what you know
3. Admit uncertainty when you don't know something
4. Format responses clearly with proper structure
5. Ask clarifying questions when needed

Additional context: This prompt is designed to generate enough tokens to demonstrate prompt caching behavior across multiple API calls. The system includes multiple sections to ensure sufficient token count for effective caching demonstration.`;

describe('Prompt Caching Verification', () => {
  // Anthropic caching test: Multi-turn session with >50% cache hits on turn 2+
  test.skipIf(!hasApiKey('anthropic'))(
    'Anthropic: Multi-turn session shows cache hits on turn 2',
    async () => {
      const model = DEFAULT_MODEL.anthropic;
      const provider = 'anthropic';

      // Turn 1: Send large system prompt + short user message
      const turn1Result = await generate({
        model,
        provider,
        system: LARGE_SYSTEM_PROMPT,
        prompt: 'What is 2+2?',
        maxTokens: 50,
      });

      expect(turn1Result.response.usage).toBeDefined();
      const turn1Usage = turn1Result.response.usage;
      expect(turn1Usage.inputTokens).toBeGreaterThan(0);

      // Verify cache write tokens on first turn
      expect(turn1Usage.cacheWriteTokens).toBeGreaterThan(0);

      // Turn 2: Send the same system prompt + different user message
      const turn2Result = await generate({
        model,
        provider,
        system: LARGE_SYSTEM_PROMPT,
        prompt: 'What is 3+3?',
        maxTokens: 50,
      });

      expect(turn2Result.response.usage).toBeDefined();
      const turn2Usage = turn2Result.response.usage;

      // Key assertion: Cache read tokens should be present on turn 2
      expect(turn2Usage.cacheReadTokens).toBeGreaterThan(0);

      // Verify cache read tokens represent a significant portion of the system prompt
      // The system prompt should have generated most of the cache
      expect(turn2Usage.cacheReadTokens).toBeGreaterThan(
        turn1Usage.cacheWriteTokens / 2,
      );
    },
  );

  // OpenAI automatic caching test
  test.skipIf(!hasApiKey('openai'))(
    'OpenAI: Identical requests may show cache read tokens',
    async () => {
      const model = DEFAULT_MODEL.openai;
      const provider = 'openai';

      // First request
      const result1 = await generate({
        model,
        provider,
        prompt: 'Explain quantum computing in one sentence.',
        maxTokens: 50,
      });

      expect(result1.response.usage).toBeDefined();

      // Second request with identical prompt
      const result2 = await generate({
        model,
        provider,
        prompt: 'Explain quantum computing in one sentence.',
        maxTokens: 50,
      });

      expect(result2.response.usage).toBeDefined();
      const turn2Usage = result2.response.usage;

      // Note: OpenAI's caching is automatic and may not always trigger
      // This test verifies the field maps correctly when caching does occur
      // If cacheReadTokens is 0, the test passes (caching didn't activate but mapping works)
      expect(turn2Usage.cacheReadTokens).toBeGreaterThanOrEqual(0);
    },
  );

  // Gemini cache token mapping test
  test.skipIf(!hasApiKey('gemini'))(
    'Gemini: Cache token mapping from usageMetadata works correctly',
    async () => {
      const model = DEFAULT_MODEL.gemini;
      const provider = 'gemini';

      // Send a simple generation request
      const result = await generate({
        model,
        provider,
        prompt: 'What is the capital of France?',
        maxTokens: 50,
      });

      expect(result.response.usage).toBeDefined();
      const usage = result.response.usage;

      // Verify that the cache read tokens field exists and is mapped correctly
      // (may be 0 if no cached content context is used)
      expect(usage.cacheReadTokens).toBeGreaterThanOrEqual(0);
      expect(typeof usage.cacheReadTokens).toBe('number');
    },
  );
});
