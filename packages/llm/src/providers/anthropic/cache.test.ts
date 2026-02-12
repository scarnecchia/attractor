import { describe, it, expect } from 'vitest';
import { injectCacheControl, injectBetaHeaders } from './cache.js';

describe('Anthropic Cache Control Injection', () => {
  describe('injectCacheControl', () => {
    it('should return body unchanged when autoCache is false', () => {
      const body = {
        system: [{ type: 'text', text: 'system prompt' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      };

      const result = injectCacheControl(body, false);

      expect(result).toEqual(body);
    });

    it('should inject cache_control on system array last block when autoCache is true', () => {
      const body = {
        system: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
        messages: [],
      };

      const result = injectCacheControl(body, true);

      const systemArray = result['system'] as Array<Record<string, unknown>> | undefined;
      expect(systemArray).toBeDefined();
      expect(systemArray!.length).toBe(2);
      expect(systemArray![1]).toHaveProperty('cache_control');
      const cacheControl = systemArray![1]!['cache_control'] as Record<string, unknown>;
      expect(cacheControl['type']).toBe('ephemeral');
    });

    it('should inject cache_control on last tool in tools array when autoCache is true', () => {
      const body = {
        tools: [
          { name: 'tool1', description: 'first' },
          { name: 'tool2', description: 'second' },
        ],
      };

      const result = injectCacheControl(body, true);

      const toolsArray = result['tools'] as Array<Record<string, unknown>> | undefined;
      expect(toolsArray).toBeDefined();
      expect(toolsArray!.length).toBe(2);
      expect(toolsArray![1]).toHaveProperty('cache_control');
      const cacheControl = toolsArray![1]!['cache_control'] as Record<string, unknown>;
      expect(cacheControl['type']).toBe('ephemeral');
    });

    it('should inject cache_control on last user message last block when autoCache is true', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'first message first block' },
              { type: 'text', text: 'first message second block' },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'assistant response' }],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'last message first block' },
              { type: 'text', text: 'last message second block' },
            ],
          },
        ],
      };

      const result = injectCacheControl(body, true);

      const messagesArray = result['messages'] as Array<Record<string, unknown>> | undefined;
      expect(messagesArray).toBeDefined();
      expect(messagesArray!.length).toBe(3);

      const lastUserMessage = messagesArray![2];
      expect(lastUserMessage).toBeDefined();
      const contentArray = (lastUserMessage as Record<string, unknown>)['content'] as Array<Record<string, unknown>> | undefined;
      expect(contentArray).toBeDefined();
      expect(contentArray!.length).toBe(2);
      expect(contentArray![1]).toHaveProperty('cache_control');
      const cacheControl = contentArray![1]!['cache_control'] as Record<string, unknown>;
      expect(cacheControl['type']).toBe('ephemeral');
    });

    it('should handle missing system, tools, or messages gracefully', () => {
      const body = {};

      const result = injectCacheControl(body, true);

      expect(result).toBeDefined();
    });

    it('should not mutate input body', () => {
      const body = {
        system: [{ type: 'text', text: 'system' }],
      };
      const bodyClone = JSON.parse(JSON.stringify(body));

      injectCacheControl(body, true);

      expect(body).toEqual(bodyClone);
    });
  });

  describe('injectBetaHeaders', () => {
    it('should not add anthropic-beta when hasCacheControl is false', () => {
      const headers = { 'Content-Type': 'application/json' };

      const result = injectBetaHeaders(headers, false);

      expect(result).toEqual(headers);
    });

    it('should add anthropic-beta header when hasCacheControl is true', () => {
      const headers = { 'Content-Type': 'application/json' };

      const result = injectBetaHeaders(headers, true);

      expect(result['anthropic-beta']).toBe('prompt-caching-2024-07-31');
    });

    it('should append to existing anthropic-beta header', () => {
      const headers = { 'anthropic-beta': 'existing-beta' };

      const result = injectBetaHeaders(headers, true);

      expect(result['anthropic-beta']).toBe('existing-beta, prompt-caching-2024-07-31');
    });

    it('should not mutate input headers', () => {
      const headers = { 'Content-Type': 'application/json' };
      const headersClone = { ...headers };

      injectBetaHeaders(headers, true);

      expect(headers).toEqual(headersClone);
    });
  });
});
