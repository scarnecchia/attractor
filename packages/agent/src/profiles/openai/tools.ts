import type { RegisteredTool } from '../../types/index.js';
import {
  createReadFileTool,
  createApplyPatchTool,
  createWriteFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from '../shared-tools.js';

export function createOpenAITools(): ReadonlyArray<RegisteredTool> {
  return [
    createReadFileTool(),
    createApplyPatchTool(),
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
    createGlobTool(),
  ];
}
