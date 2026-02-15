import type { ExecutionEnvironment, ToolExecutor, RegisteredTool } from '../types/index.js';

export const readFileExecutor: ToolExecutor = async (args, env) => {
  const filePath = args['file_path'] as string | undefined;
  const offset = args['offset'] as number | undefined;
  const limit = args['limit'] as number | undefined;

  if (!filePath || typeof filePath !== 'string') {
    return 'Error: file_path is required and must be a string';
  }

  try {
    const content = await env.readFile(filePath, offset, limit);
    const lines = content.split('\n');
    const numberedLines = lines
      .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
      .join('\n');
    return numberedLines;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error reading file: ${errorMessage}`;
  }
};

export function createReadFileTool(): RegisteredTool {
  return {
    definition: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns file content with line numbers.',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Optional byte offset to start reading from',
          },
          limit: {
            type: 'number',
            description: 'Optional number of bytes to read',
          },
        },
        required: ['file_path'],
      },
    },
    executor: readFileExecutor,
  };
}
