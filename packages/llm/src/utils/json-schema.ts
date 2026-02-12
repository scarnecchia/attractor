import type { Tool } from '../types/tool.js';

export function validateJsonSchema(schema: Record<string, unknown>): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  if (!('type' in schema)) {
    return false;
  }

  return true;
}

export function wrapSchemaForOpenAI(
  schema: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      schema,
      strict: true,
    },
  };
}

export function createExtractionTool(
  schema: Record<string, unknown>,
): Tool {
  return {
    name: '__extract',
    description: 'Extracts structured data matching the provided schema',
    parameters: schema,
  };
}
