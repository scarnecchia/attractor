import type { ToolExecutor, RegisteredTool } from '../types/index.js';

export const shellExecutor: ToolExecutor = async (args, env) => {
  const command = args['command'] as string | undefined;
  const timeoutMs = args['timeout_ms'] as number | undefined;
  const workingDir = args['working_dir'] as string | undefined;

  if (!command || typeof command !== 'string') {
    return 'Error: command is required and must be a string';
  }

  try {
    const result = await env.execCommand(command, timeoutMs, workingDir);

    const parts: Array<string> = [];

    if (result.stdout) {
      parts.push(result.stdout);
    }

    if (result.stderr) {
      if (parts.length > 0) parts.push('---stderr---');
      parts.push(result.stderr);
    }

    if (result.timedOut) {
      parts.push('[WARNING: Command timed out after ' + timeoutMs + 'ms]');
    }

    const output = parts.join('\n');
    const duration = result.durationMs ? ` (${result.durationMs}ms)` : '';
    const exitLine = `[Exit code: ${result.exitCode}${duration}]`;

    return output ? output + '\n' + exitLine : exitLine;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error executing command: ${errorMessage}`;
  }
};

export function createShellTool(): RegisteredTool {
  return {
    definition: {
      name: 'shell',
      description:
        'Execute a shell command. Returns stdout, stderr, and exit code. Supports optional timeout and working directory.',
      parameters: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          timeout_ms: {
            type: 'number',
            description: 'Optional timeout in milliseconds',
          },
          working_dir: {
            type: 'string',
            description: 'Optional working directory for the command',
          },
        },
        required: ['command'],
      },
    },
    executor: shellExecutor,
  };
}
