import { describe, it, expect } from 'vitest';
import { responseText, responseToolCalls, responseReasoning, type LLMResponse } from './response.js';

describe('response accessors', () => {
  function createResponse(content: LLMResponse['content']): LLMResponse {
    return {
      id: 'test-id',
      model: 'test-model',
      content,
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      rateLimitInfo: null,
      warnings: [],
      steps: [],
      providerMetadata: {},
    };
  }

  describe('responseText', () => {
    it('concatenates text from multiple TEXT ContentParts', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'hello' },
        { kind: 'TEXT', text: ' ' },
        { kind: 'TEXT', text: 'world' },
      ]);

      expect(responseText(response)).toBe('hello world');
    });

    it('returns empty string when no TEXT parts exist', () => {
      const response = createResponse([
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: { location: 'NYC' },
        },
      ]);

      expect(responseText(response)).toBe('');
    });

    it('ignores non-TEXT parts', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'hello' },
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: { location: 'NYC' },
        },
        { kind: 'TEXT', text: ' world' },
        { kind: 'THINKING', text: 'internal thought', signature: null },
      ]);

      expect(responseText(response)).toBe('hello world');
    });

    it('returns empty string for empty content array', () => {
      const response = createResponse([]);

      expect(responseText(response)).toBe('');
    });
  });

  describe('responseToolCalls', () => {
    it('extracts ExtractedToolCall[] from TOOL_CALL ContentParts', () => {
      const response = createResponse([
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: { location: 'NYC', unit: 'C' },
        },
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-456',
          toolName: 'getTime',
          args: { timezone: 'EST' },
        },
      ]);

      const toolCalls = responseToolCalls(response);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]).toEqual({
        toolCallId: 'call-123',
        toolName: 'getWeather',
        args: { location: 'NYC', unit: 'C' },
      });
      expect(toolCalls[1]).toEqual({
        toolCallId: 'call-456',
        toolName: 'getTime',
        args: { timezone: 'EST' },
      });
    });

    it('returns empty array when no TOOL_CALL parts exist', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'hello' },
        { kind: 'THINKING', text: 'internal thought', signature: null },
      ]);

      expect(responseToolCalls(response)).toEqual([]);
    });

    it('ignores irrelevant content kinds', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'before' },
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: { location: 'NYC' },
        },
        { kind: 'THINKING', text: 'internal thought', signature: null },
        { kind: 'TEXT', text: 'after' },
      ]);

      const toolCalls = responseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.toolName).toBe('getWeather');
    });
  });

  describe('responseReasoning', () => {
    it('extracts concatenated thinking text from THINKING ContentParts', () => {
      const response = createResponse([
        { kind: 'THINKING', text: 'first thought', signature: null },
        { kind: 'THINKING', text: ' continues here', signature: null },
        { kind: 'THINKING', text: ' ends', signature: null },
      ]);

      expect(responseReasoning(response)).toBe('first thought continues here ends');
    });

    it('returns empty string when no THINKING parts exist', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'hello' },
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: { location: 'NYC' },
        },
      ]);

      expect(responseReasoning(response)).toBe('');
    });

    it('excludes REDACTED_THINKING parts (only THINKING)', () => {
      const response = createResponse([
        { kind: 'THINKING', text: 'visible thought', signature: null },
        { kind: 'REDACTED_THINKING', data: 'hidden data' },
        { kind: 'THINKING', text: ' more visible', signature: null },
      ]);

      expect(responseReasoning(response)).toBe('visible thought more visible');
    });

    it('returns empty string for empty content array', () => {
      const response = createResponse([]);

      expect(responseReasoning(response)).toBe('');
    });

    it('ignores non-THINKING parts in mixed content', () => {
      const response = createResponse([
        { kind: 'TEXT', text: 'output text' },
        { kind: 'THINKING', text: 'thinking', signature: null },
        {
          kind: 'TOOL_CALL',
          toolCallId: 'call-123',
          toolName: 'getWeather',
          args: {},
        },
      ]);

      expect(responseReasoning(response)).toBe('thinking');
    });
  });
});
