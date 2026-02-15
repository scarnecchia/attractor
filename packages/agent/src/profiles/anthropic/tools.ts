import type { RegisteredTool } from '../../types/index.js';
import {
  createReadFileTool,
  createEditFileTool,
  createWriteFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from '../shared-tools.js';

export function createAnthropicTools(): ReadonlyArray<RegisteredTool> {
  return [
    createReadFileTool(),
    createEditFileTool(),
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
            description: 'Optional timeout in milliseconds (default: 120000ms)',
          },
          working_dir: {
            type: 'string',
            description: 'Optional working directory for command execution',
          },
        },
        required: ['command'],
      },
    }),
    createGrepTool({
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression pattern to search for',
          },
          path: {
            type: 'string',
            description: 'Optional path to search in (default: current directory)',
          },
          include: {
            type: 'string',
            description: 'Optional glob pattern to include files (e.g., "*.ts")',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive (default: true)',
          },
          context_lines: {
            type: 'number',
            description: 'Number of context lines to show around matches',
          },
        },
        required: ['pattern'],
      },
    }),
    createGlobTool(),
  ];
}
