/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectProviders } from './config.js';

describe('detectProviders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns all three providers when all env vars are set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key-test');

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['anthropic']).toBeDefined();
    expect(providers['anthropic']?.['apiKey']).toBe('sk-ant-test');
    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('gemini-key-test');
  });

  it('returns only openai when only OPENAI_API_KEY is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');

    const providers = detectProviders();

    expect(Object.keys(providers)).toEqual(['openai']);
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
  });

  it('returns empty record when no env vars are set', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_ORG_ID', '');

    const providers = detectProviders();

    expect(providers).toEqual({});
  });

  it('treats empty string env var as not present', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');

    const providers = detectProviders();

    expect(providers).toEqual({});
  });

  it('returns gemini with GOOGLE_API_KEY when GEMINI_API_KEY is not set', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', 'google-key-test');

    const providers = detectProviders();

    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('google-key-test');
  });

  it('prefers GEMINI_API_KEY over GOOGLE_API_KEY when both are set', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key-test');
    vi.stubEnv('GOOGLE_API_KEY', 'google-key-test');

    const providers = detectProviders();

    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('gemini-key-test');
  });

  it('includes OPENAI_BASE_URL in provider options', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_BASE_URL', 'https://custom.openai.com/v1');

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['baseUrl']).toBe('https://custom.openai.com/v1');
  });

  it('includes OPENAI_ORG_ID in provider options', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_ORG_ID', 'org-123');

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['organization']).toBe('org-123');
  });

  it('treats empty string option env var as not present', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_BASE_URL', '');

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['baseUrl']).toBeUndefined();
  });
});
