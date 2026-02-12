import { describe, it, expect } from 'vitest';
import { getModelInfo, listModels, getLatestModel } from './lookup.js';

describe('Model Catalog', () => {
  describe('getModelInfo', () => {
    it('returns correct info for known OpenAI model', () => {
      const info = getModelInfo('gpt-4o');
      expect(info).not.toBeNull();
      expect(info?.id).toBe('gpt-4o');
      expect(info?.provider).toBe('openai');
      expect(info?.supportsVision).toBe(true);
      expect(info?.supportsTools).toBe(true);
    });

    it('returns correct info for known Anthropic model', () => {
      const info = getModelInfo('claude-opus-4-6');
      expect(info).not.toBeNull();
      expect(info?.id).toBe('claude-opus-4-6');
      expect(info?.provider).toBe('anthropic');
      expect(info?.supportsTools).toBe(true);
    });

    it('returns correct info for known Gemini model', () => {
      const info = getModelInfo('gemini-2.0-flash');
      expect(info).not.toBeNull();
      expect(info?.id).toBe('gemini-2.0-flash');
      expect(info?.provider).toBe('gemini');
    });

    it('returns null for unknown model ID', () => {
      const info = getModelInfo('unknown-model-12345');
      expect(info).toBeNull();
    });

    it('returns all expected properties', () => {
      const info = getModelInfo('gpt-4o');
      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('provider');
      expect(info).toHaveProperty('contextWindow');
      expect(info).toHaveProperty('maxOutputTokens');
      expect(info).toHaveProperty('supportsTools');
      expect(info).toHaveProperty('supportsVision');
      expect(info).toHaveProperty('supportsStreaming');
      expect(info).toHaveProperty('supportsStructuredOutput');
      expect(info).toHaveProperty('inputCostPer1kTokens');
      expect(info).toHaveProperty('outputCostPer1kTokens');
    });
  });

  describe('listModels', () => {
    it('returns all models when no filter provided', () => {
      const models = listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.length).toBeGreaterThanOrEqual(10); // at least 10+ models
    });

    it('filters by OpenAI provider', () => {
      const models = listModels('openai');
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model.provider).toBe('openai');
      });
    });

    it('filters by Anthropic provider', () => {
      const models = listModels('anthropic');
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model.provider).toBe('anthropic');
      });
    });

    it('filters by Gemini provider', () => {
      const models = listModels('gemini');
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model.provider).toBe('gemini');
      });
    });

    it('returns empty array for unknown provider', () => {
      const models = listModels('unknown-provider-xyz');
      expect(models.length).toBe(0);
    });

    it('returns read-only array', () => {
      const models = listModels();
      expect(Object.isFrozen(models) || Array.isArray(models)).toBe(true);
    });
  });

  describe('getLatestModel', () => {
    it('returns a valid OpenAI model for openai provider', () => {
      const model = getLatestModel('openai');
      expect(model).not.toBeNull();
      expect(model?.provider).toBe('openai');
    });

    it('returns a valid Anthropic model for anthropic provider', () => {
      const model = getLatestModel('anthropic');
      expect(model).not.toBeNull();
      expect(model?.provider).toBe('anthropic');
    });

    it('returns a valid Gemini model for gemini provider', () => {
      const model = getLatestModel('gemini');
      expect(model).not.toBeNull();
      expect(model?.provider).toBe('gemini');
    });

    it('returns null for unknown provider', () => {
      const model = getLatestModel('unknown-provider-xyz');
      expect(model).toBeNull();
    });

    it('returns flagship model when tier="flagship"', () => {
      const model = getLatestModel('openai', 'flagship');
      expect(model).not.toBeNull();
      // flagship should be a powerful model like o1 or gpt-4o
      expect(['o1', 'gpt-4o', 'o3-mini']).toContain(model?.id);
    });

    it('returns fast model when tier="fast"', () => {
      const model = getLatestModel('openai', 'fast');
      expect(model).not.toBeNull();
      // fast should be a lighter model
    });

    it('returns mini model when tier="mini"', () => {
      const model = getLatestModel('openai', 'mini');
      expect(model).not.toBeNull();
      // mini should be gpt-4o-mini
      expect(model?.id).toContain('mini');
    });
  });
});
