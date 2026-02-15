import type { ToolExecutor, RegisteredTool } from '../types/index.js';

export const writeFileExecutor: ToolExecutor = async (args, env) => {
  const filePath = args['file_path'] as string | undefined;
  const content = args['content'] as string | undefined;

  if (!filePath || typeof filePath !== 'string') {
    return 'Error: file_path is required and must be a string';
  }

  if (content === undefined) {
    return 'Error: content is required';
  }

  try {
    await env.writeFile(filePath, String(content));
    const byteLength = Buffer.byteLength(String(content), 'utf8');
    return `Wrote ${byteLength} bytes to ${filePath}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error writing file: ${errorMessage}`;
  }
};

export function createWriteFileTool(): RegisteredTool {
  return {
    definition: {
      name: 'write_file',
      description: 'Write content to a file. Creates parent directories if needed.',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file to write',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
    executor: writeFileExecutor,
  };
}
