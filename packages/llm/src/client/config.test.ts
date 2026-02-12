import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectProviders } from './config.js';

describe('detectProviders', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns all three providers when all env vars are set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['GEMINI_API_KEY'] = 'gemini-key-test';

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['anthropic']).toBeDefined();
    expect(providers['anthropic']?.['apiKey']).toBe('sk-ant-test');
    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('gemini-key-test');
  });

  it('returns only openai when only OPENAI_API_KEY is set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];

    const providers = detectProviders();

    expect(Object.keys(providers)).toEqual(['openai']);
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
  });

  it('returns empty record when no env vars are set', () => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
    delete process.env['OPENAI_ORG_ID'];

    const providers = detectProviders();

    expect(providers).toEqual({});
  });

  it('treats empty string env var as not present', () => {
    process.env['OPENAI_API_KEY'] = '';
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];

    const providers = detectProviders();

    expect(providers).toEqual({});
  });

  it('returns gemini with GOOGLE_API_KEY when GEMINI_API_KEY is not set', () => {
    delete process.env['GEMINI_API_KEY'];
    process.env['GOOGLE_API_KEY'] = 'google-key-test';

    const providers = detectProviders();

    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('google-key-test');
  });

  it('prefers GEMINI_API_KEY over GOOGLE_API_KEY when both are set', () => {
    process.env['GEMINI_API_KEY'] = 'gemini-key-test';
    process.env['GOOGLE_API_KEY'] = 'google-key-test';

    const providers = detectProviders();

    expect(providers['gemini']).toBeDefined();
    expect(providers['gemini']?.['apiKey']).toBe('gemini-key-test');
  });

  it('includes OPENAI_BASE_URL in provider options', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['OPENAI_BASE_URL'] = 'https://custom.openai.com/v1';

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['baseUrl']).toBe('https://custom.openai.com/v1');
  });

  it('includes OPENAI_ORG_ID in provider options', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['OPENAI_ORG_ID'] = 'org-123';

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['organization']).toBe('org-123');
  });

  it('treats empty string option env var as not present', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['OPENAI_BASE_URL'] = '';

    const providers = detectProviders();

    expect(providers['openai']).toBeDefined();
    expect(providers['openai']?.['apiKey']).toBe('sk-test');
    expect(providers['openai']?.['baseUrl']).toBeUndefined();
  });
});
