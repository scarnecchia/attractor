import { describe, it, expect } from 'vitest';
import { translateResponse } from './response.js';

describe('Anthropic Response Translation', () => {
  describe('Basic response mapping', () => {
    it('should map id and model from raw response', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.id).toBe('msg-123');
      expect(result.model).toBe('claude-opus-4-6');
    });
  });

  describe('Content translation', () => {
    it('should translate text content blocks', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: 'hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.content).toHaveLength(1);
      const text = result.content[0];
      expect(text.kind).toBe('TEXT');
      expect(text.text).toBe('hello world');
    });

    it('should translate tool_use content blocks', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [
          {
            type: 'tool_use',
            id: 'call-123',
            name: 'get_weather',
            input: { location: 'NY' },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'tool_use',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.content).toHaveLength(1);
      const toolCall = result.content[0];
      expect(toolCall.kind).toBe('TOOL_CALL');
      expect(toolCall.toolCallId).toBe('call-123');
      expect(toolCall.toolName).toBe('get_weather');
      expect(toolCall.args).toEqual({ location: 'NY' });
    });

    it('should translate thinking content blocks', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [
          {
            type: 'thinking',
            thinking: 'let me think about this',
            signature: 'sig-abc',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.content).toHaveLength(1);
      const thinking = result.content[0];
      expect(thinking.kind).toBe('THINKING');
      expect(thinking.text).toBe('let me think about this');
      expect(thinking.signature).toBe('sig-abc');
    });

    it('should translate redacted_thinking content blocks', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [
          {
            type: 'redacted_thinking',
            data: 'base64encodeddata',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.content).toHaveLength(1);
      const redacted = result.content[0];
      expect(redacted.kind).toBe('REDACTED_THINKING');
      expect(redacted.data).toBe('base64encodeddata');
    });
  });

  describe('Usage translation', () => {
    it('should map input and output tokens', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.totalTokens).toBe(150);
    });

    it('should map cache_read_input_tokens to cacheReadTokens (AC8.4)', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 25,
        },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.usage.cacheReadTokens).toBe(25);
    });

    it('should map cache_creation_input_tokens to cacheWriteTokens (AC8.5)', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 30,
        },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.usage.cacheWriteTokens).toBe(30);
    });
  });

  describe('Finish reason translation', () => {
    it('should map end_turn to stop', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.finishReason).toBe('stop');
    });

    it('should map max_tokens to length', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'max_tokens',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.finishReason).toBe('length');
    });

    it('should map tool_use to tool_calls', () => {
      const raw = {
        id: 'msg-123',
        model: 'claude-opus-4-6',
        content: [{ type: 'tool_use', id: 'call-123', name: 'fn', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'tool_use',
      };

      const result = translateResponse(raw as Record<string, unknown>);

      expect(result.finishReason).toBe('tool_calls');
    });
  });
});
