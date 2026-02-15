import type { ToolExecutor, RegisteredTool } from '../types/index.js';

export const editFileExecutor: ToolExecutor = async (args, env) => {
  const filePath = args['file_path'] as string | undefined;
  const oldString = args['old_string'] as string | undefined;
  const newString = args['new_string'] as string | undefined;
  const replaceAll = args['replace_all'] as boolean | undefined;

  if (!filePath || typeof filePath !== 'string') {
    return 'Error: file_path is required and must be a string';
  }

  if (oldString === undefined) {
    return 'Error: old_string is required';
  }

  if (newString === undefined) {
    return 'Error: new_string is required';
  }

  try {
    const content = await env.readFile(filePath);
    const oldStringStr = String(oldString);
    const newStringStr = String(newString);

    const occurrences = countOccurrences(content, oldStringStr);

    if (occurrences === 0) {
      return `Error: old_string not found in file. The string to replace:\n"${oldStringStr}"\n\nwas not found in ${filePath}`;
    }

    if (occurrences > 1 && !replaceAll) {
      return `Error: old_string appears ${occurrences} times in the file. Please be more specific or set replace_all to true.\n\nThe string:\n"${oldStringStr}"\n\nappears multiple times. Please provide more context or use replace_all: true to replace all occurrences.`;
    }

    let updatedContent: string;
    if (replaceAll || occurrences === 1) {
      updatedContent = content.split(oldStringStr).join(newStringStr);
    } else {
      updatedContent = content.replace(oldStringStr, newStringStr);
    }

    await env.writeFile(filePath, updatedContent);

    const replacedCount = replaceAll ? occurrences : 1;
    return `Successfully replaced ${replacedCount} occurrence${replacedCount !== 1 ? 's' : ''} in ${filePath}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error editing file: ${errorMessage}`;
  }
};

function countOccurrences(text: string, substring: string): number {
  if (!substring) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

export function createEditFileTool(): RegisteredTool {
  return {
    definition: {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific string with new content. Uses string matching (not line-based).',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace. Must be unique unless replace_all is true.',
          },
          new_string: {
            type: 'string',
            description: 'The new content to replace old_string with',
          },
          replace_all: {
            type: 'boolean',
            description: 'If true, replace all occurrences. If false (default), old_string must be unique.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    executor: editFileExecutor,
  };
}
