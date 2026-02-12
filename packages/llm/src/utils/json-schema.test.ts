import { describe, it, expect } from 'vitest';
import {
  validateJsonSchema,
  wrapSchemaForOpenAI,
  createExtractionTool,
} from './json-schema.js';

describe('JSON Schema helpers', () => {
  describe('validateJsonSchema', () => {
    it('returns true for valid schema with type and properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      expect(validateJsonSchema(schema)).toBe(true);
    });

    it('returns false for schema missing type field', () => {
      const schema = {
        properties: {
          name: { type: 'string' },
        },
      };
      expect(validateJsonSchema(schema)).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(validateJsonSchema({})).toBe(false);
    });
  });

  describe('wrapSchemaForOpenAI', () => {
    it('wraps schema in OpenAI format with correct structure', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      const result = wrapSchemaForOpenAI(schema, 'TestTool');

      expect(result).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'TestTool',
          schema,
          strict: true,
        },
      });
    });

    it('preserves the input schema exactly', () => {
      const schema = {
        type: 'object',
        properties: {
          age: { type: 'number' },
          active: { type: 'boolean' },
        },
        required: ['age'],
      };
      const result = wrapSchemaForOpenAI(schema, 'PersonTool');

      const jsonSchema = result['json_schema'] as Record<string, unknown>;
      expect(jsonSchema['schema']).toEqual(schema);
    });

    it('sets strict to true', () => {
      const schema = { type: 'object' };
      const result = wrapSchemaForOpenAI(schema, 'Tool');

      const jsonSchema = result['json_schema'] as Record<string, unknown>;
      expect(jsonSchema['strict']).toBe(true);
    });
  });

  describe('createExtractionTool', () => {
    it('returns a Tool with name __extract', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      const tool = createExtractionTool(schema);

      expect(tool.name).toBe('__extract');
    });

    it('sets parameters to the input schema', () => {
      const schema = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
      };
      const tool = createExtractionTool(schema);

      expect(tool.parameters).toEqual(schema);
    });

    it('has no execute function', () => {
      const schema = { type: 'object' };
      const tool = createExtractionTool(schema);

      expect(tool.execute).toBeUndefined();
    });

    it('returns a Tool with description', () => {
      const schema = { type: 'object' };
      const tool = createExtractionTool(schema);

      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
    });
  });
});
