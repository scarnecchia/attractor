import type { ToolExecutor, RegisteredTool } from '../types/index.js';

export const grepExecutor: ToolExecutor = async (args, env) => {
  const pattern = args['pattern'] as string | undefined;
  const path = args['path'] as string | undefined;
  const caseSensitive = args['case_sensitive'] as boolean | undefined;
  const maxResults = args['max_results'] as number | undefined;
  const includePattern = args['include'] as string | undefined;

  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required and must be a string';
  }

  const searchPath = path ?? '.';

  try {
    const result = await env.grep(pattern, searchPath, {
      caseSensitive,
      maxResults,
      includePattern,
    });

    if (!result || result.trim().length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error executing grep: ${errorMessage}`;
  }
};

export function createGrepTool(): RegisteredTool {
  return {
    definition: {
      name: 'grep',
      description:
        'Search for a pattern in files using regex. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression pattern to search for',
          },
          path: {
            type: 'string',
            description: 'Optional path to search in (default: current directory)',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive (default: true)',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
          include: {
            type: 'string',
            description: 'Optional glob pattern to include files (e.g., "*.ts")',
          },
        },
        required: ['pattern'],
      },
    },
    executor: grepExecutor,
  };
}
