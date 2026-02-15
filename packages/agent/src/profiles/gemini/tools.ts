import type { RegisteredTool, ToolDefinition, ToolExecutor, ExecutionEnvironment } from '../../types/index.js';
import {
  createReadFileTool,
  createEditFileTool,
  createWriteFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
  createListDirTool,
  readFileDefinition,
  editFileDefinition,
  globDefinition,
  createRegisteredTool,
} from '../shared-tools.js';
import { readFileExecutor } from '../../tools/read-file.js';
import { editFileExecutor } from '../../tools/edit-file.js';
import { globExecutor } from '../../tools/glob.js';

export function createGeminiTools(): ReadonlyArray<RegisteredTool> {
  return [
    // read_file with "path" parameter (0-based offset) instead of "file_path"
    createRegisteredTool(
      readFileDefinition({
        name: 'read_file',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to read',
            },
            offset: {
              type: 'number',
              description: 'Line number to start reading from (0-based)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of lines to read',
            },
          },
          required: ['path'],
        },
      }),
      // Custom executor that accepts "path" instead of "file_path"
      createGeminiReadFileExecutor(),
    ),

    // edit_file with "expected_replacements" count instead of "replace_all" boolean
    createRegisteredTool(
      editFileDefinition({
        name: 'edit_file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to the file to edit',
            },
            old_string: {
              type: 'string',
              description: 'The exact string to find and replace.',
            },
            new_string: {
              type: 'string',
              description: 'The new content to replace old_string with',
            },
            expected_replacements: {
              type: 'number',
              description: 'Expected number of replacements (default: 1)',
            },
          },
          required: ['file_path', 'old_string', 'new_string'],
        },
      }),
      // Custom executor that handles expected_replacements count
      createGeminiEditFileExecutor(),
    ),

    createWriteFileTool(),

    createShellTool({
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          timeout_ms: {
            type: 'number',
            description: 'Optional timeout in milliseconds (default: 10000ms)',
          },
          working_dir: {
            type: 'string',
            description: 'Optional working directory for command execution',
          },
        },
        required: ['command'],
      },
    }),

    createGrepTool(),

    // glob with "case_sensitive" parameter
    createRegisteredTool(
      globDefinition({
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Glob pattern to match files (e.g., "**/*.ts")',
            },
            path: {
              type: 'string',
              description: 'Optional base path to search in (default: current directory)',
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Whether the glob pattern matching is case-sensitive (default: false)',
            },
          },
          required: ['pattern'],
        },
      }),
      globExecutor,
    ),

    createListDirTool(),
  ];
}

function createGeminiReadFileExecutor(): ToolExecutor {
  return async (args, env) => {
    const modifiedArgs = {
      file_path: args['path'] ?? args['file_path'],
      offset: args['offset'],
      limit: args['limit'],
    };
    return readFileExecutor(modifiedArgs, env);
  };
}

function createGeminiEditFileExecutor(): ToolExecutor {
  return async (args, env) => {
    const expectedReplacements = (args['expected_replacements'] as number | undefined) ?? 1;
    const modifiedArgs = {
      file_path: args['file_path'],
      old_string: args['old_string'],
      new_string: args['new_string'],
      replace_all: expectedReplacements > 1,
    };
    return editFileExecutor(modifiedArgs, env);
  };
}
