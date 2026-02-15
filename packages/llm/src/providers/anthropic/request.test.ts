import { describe, it, expect } from 'vitest';
import { translateRequest } from './request.js';
import type { LLMRequest } from '../../types/index.js';

describe('Anthropic Request Translation', () => {
  describe('AC3.2 - Headers', () => {
    it('should include x-api-key and anthropic-version headers', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.headers['x-api-key']).toBe('test-api-key');
      expect(result.headers['anthropic-version']).toBe('2023-06-01');
      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('AC3.5 - Message role translation', () => {
    it('should translate system message to body.system array', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['system']).toBeDefined();
      const systemArray = result.body['system'] as Array<Record<string, unknown>>;
      expect(systemArray).toHaveLength(1);
      expect(systemArray[0]!['type']).toBe('text');
      expect(systemArray[0]!['text']).toBe('You are helpful');
    });

    it('should translate user text message correctly', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('user');
      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content).toHaveLength(1);
      expect(content[0]!['type']).toBe('text');
      expect(content[0]!['text']).toBe('hello');
    });

    it('should translate assistant message correctly', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'assistant', content: 'response' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('assistant');
      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content).toHaveLength(1);
      expect(content[0]!['type']).toBe('text');
    });

    it('should translate tool result message correctly', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: 'tool output',
                isError: false,
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('user');
      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content).toHaveLength(1);
      expect(content[0]!['type']).toBe('tool_result');
      expect(content[0]!['tool_use_id']).toBe('call-123');
      expect(content[0]!['content']).toBe('tool output');
    });

    it('should translate developer message as user', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'developer', content: 'system-like message' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('user');
    });

    it('should merge consecutive user messages', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'first' },
          {
            role: 'tool',
            content: [
              {
                kind: 'TOOL_RESULT',
                toolCallId: 'call-123',
                content: 'result',
                isError: false,
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('user');
      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content.length).toBeGreaterThan(1);
    });
  });

  describe('AC3.6 - Provider options escape hatch', () => {
    it('should merge providerOptions.anthropic into body', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            metadata: { key: 'value' },
          },
        },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['metadata']).toEqual({ key: 'value' });
    });
  });

  describe('AC3.7 - Beta headers', () => {
    it('should merge betaHeaders into anthropic-beta header', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            betaHeaders: { something: 'my-beta-value' },
          },
        },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.headers['anthropic-beta']).toContain('my-beta-value');
      expect(result.headers['anthropic-beta']).toContain('prompt-caching-2024-07-31');
    });
  });

  describe('AC4.1 - Text-only messages', () => {
    it('should handle text-only user message', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello world' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['type']).toBe('text');
      expect(content[0]!['text']).toBe('hello world');
    });
  });

  describe('AC4.2 - Image base64', () => {
    it('should translate base64 image correctly', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              { kind: 'TEXT', text: 'describe this' },
              {
                kind: 'IMAGE',
                data: 'iVBORw0KGgo=',
                url: null,
                mediaType: 'image/png',
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const imageBlock = content.find((c) => (c['type'] as string) === 'image');
      expect(imageBlock).toBeDefined();
      const source = imageBlock!['source'] as Record<string, unknown>;
      expect(source['type']).toBe('base64');
      expect(source['media_type']).toBe('image/png');
      expect(source['data']).toBe('iVBORw0KGgo=');
    });
  });

  describe('AC4.3 - Image URL', () => {
    it('should translate image URL correctly', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              { kind: 'TEXT', text: 'describe this' },
              {
                kind: 'IMAGE',
                data: null,
                url: 'https://example.com/image.png',
                mediaType: 'image/png',
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const imageBlock = content.find((c) => (c['type'] as string) === 'image');
      expect(imageBlock).toBeDefined();
      const source = imageBlock!['source'] as Record<string, unknown>;
      expect(source['type']).toBe('url');
      expect(source['url']).toBe('https://example.com/image.png');
    });
  });

  describe('AC4.5 - Tool calls in messages', () => {
    it('should parse tool call in response', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                kind: 'TOOL_CALL',
                toolCallId: 'call-123',
                toolName: 'get_weather',
                args: { location: 'NY' },
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      const content = messagesArray[0]!['content'] as Array<Record<string, unknown>>;
      const toolUseBlock = content.find((c) => (c['type'] as string) === 'tool_use');
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock!['id']).toBe('call-123');
      expect(toolUseBlock!['name']).toBe('get_weather');
    });
  });

  describe('AC8.1, AC8.2, AC8.3 - Cache control injection', () => {
    it('should inject cache_control when autoCache is true (default)', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const systemArray = result.body['system'] as Array<Record<string, unknown>>;
      const lastBlock = systemArray[systemArray.length - 1];
      expect(lastBlock!['cache_control']).toBeDefined();
      expect(result.headers['anthropic-beta']).toContain('prompt-caching-2024-07-31');
    });

    it('should not inject cache_control when autoCache is false', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'hello' }],
        providerOptions: {
          anthropic: {
            autoCache: false,
          },
        },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const systemArray = result.body['system'] as Array<Record<string, unknown>>;
      const lastBlock = systemArray[systemArray.length - 1];
      expect(lastBlock!['cache_control']).toBeUndefined();
    });
  });

  describe('max_tokens default', () => {
    it('should default max_tokens to 4096 when not specified', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['max_tokens']).toBe(4096);
    });

    it('should use provided maxTokens', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        maxTokens: 1000,
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['max_tokens']).toBe(1000);
    });
  });

  describe('Tool choice translation', () => {
    it('should translate tool choice auto', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        toolChoice: { mode: 'auto' },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const toolChoice = result.body['tool_choice'] as Record<string, unknown>;
      expect(toolChoice['type']).toBe('auto');
    });

    it('should translate tool choice required', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        toolChoice: { mode: 'required' },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const toolChoice = result.body['tool_choice'] as Record<string, unknown>;
      expect(toolChoice['type']).toBe('any');
    });

    it('should translate tool choice named', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        toolChoice: { mode: 'named', toolName: 'my_tool' },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const toolChoice = result.body['tool_choice'] as Record<string, unknown>;
      expect(toolChoice['type']).toBe('tool');
      expect(toolChoice['name']).toBe('my_tool');
    });
  });

  describe('URL validation', () => {
    it('should use correct API endpoint', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.url).toBe('https://api.anthropic.com/v1/messages');
    });
  });

  describe('AC9.4 - Thinking block signature round-trip', () => {
    it('should translate thinking content with signature', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                kind: 'THINKING',
                text: 'Let me analyze this problem step by step',
                signature: 'abc123def456',
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      expect(messagesArray).toHaveLength(1);
      const msg = messagesArray[0]!;
      expect(msg['role']).toBe('assistant');

      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content).toHaveLength(1);
      expect(content[0]!['type']).toBe('thinking');
      expect(content[0]!['thinking']).toBe('Let me analyze this problem step by step');
      expect(content[0]!['signature']).toBe('abc123def456');
    });

    it('should handle thinking content without signature', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                kind: 'THINKING',
                text: 'Analysis',
                signature: null,
              },
            ],
          },
        ],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      const messagesArray = result.body['messages'] as Array<Record<string, unknown>>;
      const msg = messagesArray[0]!;
      const content = msg['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['type']).toBe('thinking');
      expect(content[0]!['thinking']).toBe('Analysis');
      expect(content[0]!['signature']).toBeNull();
    });
  });

  describe('AC10.9 - Anthropic none toolChoice mode', () => {
    it('should not set tool_choice when mode is none', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        toolChoice: { mode: 'none' },
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['tool_choice']).toBeUndefined();
    });
  });

  describe('reasoningEffort', () => {
    it('maps low/medium/high to provider-specific format', () => {
      const budgetMap = {
        low: 1024,
        medium: 4096,
        high: 16384,
      };

      for (const [effort, budget] of Object.entries(budgetMap)) {
        const request: LLMRequest = {
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
          reasoningEffort: effort as 'low' | 'medium' | 'high',
        };

        const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

        expect(result.body['thinking']).toBeDefined();
        const thinking = result.body['thinking'] as Record<string, unknown>;
        expect(thinking['type']).toBe('enabled');
        expect(thinking['budget_tokens']).toBe(budget);
      }
    });

    it('omits reasoning params when reasoningEffort is undefined', () => {
      const request: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = translateRequest(request, 'test-api-key', 'https://api.anthropic.com');

      expect(result.body['thinking']).toBeUndefined();
    });

    it('changing reasoningEffort between calls produces different bodies', () => {
      const request1: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        reasoningEffort: 'low',
      };

      const result1 = translateRequest(request1, 'test-api-key', 'https://api.anthropic.com');

      const request2: LLMRequest = {
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        reasoningEffort: 'high',
      };

      const result2 = translateRequest(request2, 'test-api-key', 'https://api.anthropic.com');

      expect(result1.body['thinking']).toBeDefined();
      expect(result2.body['thinking']).toBeDefined();
      const thinking1 = result1.body['thinking'] as Record<string, unknown>;
      const thinking2 = result2.body['thinking'] as Record<string, unknown>;
      expect(thinking1['budget_tokens']).toBe(1024);
      expect(thinking2['budget_tokens']).toBe(16384);
    });
  });
});
