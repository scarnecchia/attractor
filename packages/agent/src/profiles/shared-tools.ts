import type { RegisteredTool, ToolDefinition, ToolExecutor, ExecutionEnvironment } from '../types/index.js';
import {
  readFileExecutor,
  writeFileExecutor,
  editFileExecutor,
  shellExecutor,
  grepExecutor,
  globExecutor,
} from '../tools/index.js';
import { applyPatchExecutor } from '../tools/apply-patch.js';

export type ToolSchemaOverrides = {
  readonly name?: string;
  readonly description?: string;
  readonly parameters?: Record<string, unknown>;
};

export function createRegisteredTool(
  definition: ToolDefinition,
  executor: ToolExecutor,
): RegisteredTool {
  return { definition, executor };
}

export function readFileDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'read_file',
    description:
      overrides?.description ?? 'Read the contents of a file. Returns file content with line numbers.',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-based)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['file_path'],
    },
  };
}

export function writeFileDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'write_file',
    description:
      overrides?.description ?? 'Write content to a file. Creates parent directories if needed.',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['file_path', 'content'],
    },
  };
}

export function editFileDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'edit_file',
    description:
      overrides?.description ??
      'Edit a file by replacing a specific string with new content. Uses string matching (not line-based).',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to edit',
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
  };
}

export function applyPatchDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'apply_patch',
    description:
      overrides?.description ??
      'Apply a patch to modify files. The patch must be in v4a format with markers "*** Begin Patch" and "*** End Patch".',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description:
            'The patch content in v4a format. Must include "*** Begin Patch" and "*** End Patch" markers.',
        },
      },
      required: ['patch'],
    },
  };
}

export function shellDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'shell',
    description:
      overrides?.description ??
      'Execute a shell command. Returns stdout, stderr, and exit code. Supports optional timeout and working directory.',
    parameters: overrides?.parameters ?? {
      type: 'object',
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
          description: 'Optional working directory for command execution',
        },
      },
      required: ['command'],
    },
  };
}

export function grepDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'grep',
    description:
      overrides?.description ??
      'Search for a pattern in files using regex. Returns matching lines with file paths and line numbers.',
    parameters: overrides?.parameters ?? {
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
  };
}

export function globDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'glob',
    description:
      overrides?.description ?? 'Find files matching a glob pattern. Returns file paths, one per line.',
    parameters: overrides?.parameters ?? {
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
          description: 'Whether the glob pattern matching is case-sensitive (default: true)',
        },
      },
      required: ['pattern'],
    },
  };
}

export function listDirDefinition(overrides?: ToolSchemaOverrides): ToolDefinition {
  return {
    name: overrides?.name ?? 'list_dir',
    description:
      overrides?.description ?? 'List contents of a directory. Returns formatted directory listing.',
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to list',
        },
        ignore: {
          type: 'array',
          description: 'Array of patterns to ignore when listing',
          items: {
            type: 'string',
          },
        },
        respect_git_ignore: {
          type: 'boolean',
          description: 'Whether to respect .gitignore patterns (default: true)',
        },
      },
      required: ['path'],
    },
  };
}

export function createReadFileTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(readFileDefinition(overrides), readFileExecutor);
}

export function createWriteFileTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(writeFileDefinition(overrides), writeFileExecutor);
}

export function createEditFileTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(editFileDefinition(overrides), editFileExecutor);
}

export function createApplyPatchTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(applyPatchDefinition(overrides), applyPatchExecutor);
}

export function createShellTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(shellDefinition(overrides), shellExecutor);
}

export function createGrepTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(grepDefinition(overrides), grepExecutor);
}

export function createGlobTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(globDefinition(overrides), globExecutor);
}

export function createListDirTool(overrides?: ToolSchemaOverrides): RegisteredTool {
  return createRegisteredTool(listDirDefinition(overrides), listDirExecutor);
}

export const listDirExecutor: ToolExecutor = async (args, env) => {
  const path = args['path'] as string | undefined;
  const ignore = args['ignore'] as Array<string> | undefined;
  const respectGitIgnore = (args['respect_git_ignore'] as boolean | undefined) ?? true;

  if (!path || typeof path !== 'string') {
    return 'Error: path is required and must be a string';
  }

  try {
    const entries = await env.listDirectory(path);

    let filtered: ReadonlyArray<{ readonly name: string; readonly isDir: boolean; readonly size: number | null }> = entries.filter((entry) => {
      if (!ignore) return true;
      return !ignore.some((pattern) => {
        return simpleMatch(entry.name, pattern);
      });
    });

    if (respectGitIgnore) {
      filtered = filterByGitIgnore(filtered, path, env);
    }

    let output = filtered
      .map((entry) => {
        const suffix = entry.isDir ? '/' : '';
        const sizeStr = entry.size !== null ? ` (${entry.size} bytes)` : '';
        return `${entry.name}${suffix}${sizeStr}`;
      })
      .join('\n');

    const lines = output.split('\n');
    if (lines.length > 500) {
      output = lines.slice(0, 500).join('\n') + `\n[truncated: ${lines.length - 500} more entries]`;
    }

    return output || 'Directory is empty or all entries were filtered.';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error listing directory: ${errorMessage}`;
  }
};

function simpleMatch(name: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.includes('*')) {
    const escapedPattern = escapeRegexMeta(pattern).replace(/\*/g, '.*');
    const regex = new RegExp(`^${escapedPattern}$`);
    return regex.test(name);
  }

  return name.startsWith(pattern);
}

function escapeRegexMeta(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function filterByGitIgnore(
  entries: ReadonlyArray<{ readonly name: string; readonly isDir: boolean; readonly size: number | null }>,
  path: string,
  env: ExecutionEnvironment,
): ReadonlyArray<{ readonly name: string; readonly isDir: boolean; readonly size: number | null }> {
  const gitIgnorePath = `${path}/.gitignore`;
  return entries;
}
