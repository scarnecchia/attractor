import type { ToolExecutor, RegisteredTool } from '../types/index.js';

export const globExecutor: ToolExecutor = async (args, env) => {
  const pattern = args['pattern'] as string | undefined;
  const path = args['path'] as string | undefined;

  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required and must be a string';
  }

  const searchPath = path ?? '.';

  try {
    const results = await env.glob(pattern, searchPath);

    if (!results || results.length === 0) {
      return `No files matching pattern: ${pattern}`;
    }

    return results.join('\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error executing glob: ${errorMessage}`;
  }
};

export function createGlobTool(): RegisteredTool {
  return {
    definition: {
      name: 'glob',
      description: 'Find files matching a glob pattern. Returns file paths, one per line.',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g., "**/*.ts")',
          },
          path: {
            type: 'string',
            description: 'Optional base path to search in (default: current directory)',
          },
        },
        required: ['pattern'],
      },
    },
    executor: globExecutor,
  };
}
