import type { ToolExecutor, RegisteredTool } from '../types/index.js';
import type { ExecutionEnvironment } from '../types/index.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type HunkLine =
  | { readonly kind: 'context'; readonly text: string }
  | { readonly kind: 'add'; readonly text: string }
  | { readonly kind: 'remove'; readonly text: string };

export type Hunk = {
  readonly contextHeader: string | null;
  readonly lines: ReadonlyArray<HunkLine>;
};

export type PatchOperation =
  | { readonly kind: 'add'; readonly path: string; readonly content: string }
  | { readonly kind: 'delete'; readonly path: string }
  | {
      readonly kind: 'update';
      readonly path: string;
      readonly moveTo: string | null;
      readonly hunks: ReadonlyArray<Hunk>;
    };

// ============================================================================
// Parser Implementation
// ============================================================================

export function parsePatch(text: string): PatchOperation[] | string {
  const beginIdx = text.indexOf('*** Begin Patch');
  if (beginIdx === -1) {
    return 'Error: Missing "*** Begin Patch" marker';
  }

  const endIdx = text.indexOf('*** End Patch', beginIdx);
  if (endIdx === -1) {
    return 'Error: Missing "*** End Patch" marker';
  }

  const patchContent = text.substring(beginIdx + '*** Begin Patch'.length, endIdx).trim();
  const lines = patchContent.split('\n');

  const operations: PatchOperation[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    if (line.startsWith('*** Add File: ')) {
      const path = line.substring('*** Add File: '.length).trim();
      i++;

      const contentLines: string[] = [];
      while (i < lines.length && lines[i]?.startsWith('+')) {
        const contentLine = lines[i];
        if (contentLine) {
          contentLines.push(contentLine.substring(1));
        }
        i++;
      }

      operations.push({
        kind: 'add',
        path,
        content: contentLines.join('\n'),
      });
    } else if (line.startsWith('*** Delete File: ')) {
      const path = line.substring('*** Delete File: '.length).trim();
      operations.push({
        kind: 'delete',
        path,
      });
      i++;
    } else if (line.startsWith('*** Update File: ')) {
      const path = line.substring('*** Update File: '.length).trim();
      i++;

      let moveTo: string | null = null;
      if (i < lines.length && lines[i]?.startsWith('*** Move to: ')) {
        const moveToLine = lines[i];
        if (moveToLine) {
          moveTo = moveToLine.substring('*** Move to: '.length).trim();
        }
        i++;
      }

      const hunks: Hunk[] = [];
      while (i < lines.length && lines[i]?.startsWith('@@')) {
        const contextHeader = lines[i] ?? null;
        i++;

        const hunkLines: HunkLine[] = [];
        while (i < lines.length) {
          const hunkLine = lines[i];
          if (!hunkLine) {
            break;
          }

          if (hunkLine.startsWith('@@')) {
            break;
          }
          if (hunkLine.startsWith('*** ')) {
            break;
          }

          if (hunkLine.startsWith(' ')) {
            hunkLines.push({
              kind: 'context',
              text: hunkLine.substring(1),
            });
            i++;
          } else if (hunkLine.startsWith('-')) {
            hunkLines.push({
              kind: 'remove',
              text: hunkLine.substring(1),
            });
            i++;
          } else if (hunkLine.startsWith('+')) {
            hunkLines.push({
              kind: 'add',
              text: hunkLine.substring(1),
            });
            i++;
          } else {
            break;
          }
        }

        hunks.push({
          contextHeader,
          lines: hunkLines,
        });
      }

      operations.push({
        kind: 'update',
        path,
        moveTo,
        hunks,
      });
    } else if (line.trim() === '') {
      i++;
    } else {
      return `Error: Invalid line in patch: "${line}"`;
    }
  }

  return operations;
}

// ============================================================================
// Context Matching Algorithm
// ============================================================================

function matchContext(
  fileLines: string[],
  contextLines: Array<{ text: string; kind: 'context' | 'remove' }>,
): number | null {
  // Strategy 1: Exact match
  let exactMatchIdx = findExactMatch(fileLines, contextLines);
  if (exactMatchIdx !== null) {
    return exactMatchIdx;
  }

  // Strategy 2: Whitespace-trimmed match
  let trimmedMatchIdx = findTrimmedMatch(fileLines, contextLines);
  if (trimmedMatchIdx !== null) {
    return trimmedMatchIdx;
  }

  // Strategy 3: Fuzzy match (first context line only)
  if (contextLines.length > 0) {
    const firstLine = contextLines[0];
    if (firstLine) {
      const firstContext = firstLine.text;
      for (let i = 0; i < fileLines.length; i++) {
        const fileLine = fileLines[i];
        if (fileLine === firstContext) {
          return i;
        }
      }
    }
  }

  return null;
}

function findExactMatch(
  fileLines: string[],
  contextLines: Array<{ text: string; kind: 'context' | 'remove' }>,
): number | null {
  if (contextLines.length === 0) return 0;

  for (let startIdx = 0; startIdx <= fileLines.length - contextLines.length; startIdx++) {
    let allMatch = true;
    for (let i = 0; i < contextLines.length; i++) {
      const fileLine = fileLines[startIdx + i];
      const contextLine = contextLines[i];
      if (!fileLine || !contextLine || fileLine !== contextLine.text) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return startIdx;
    }
  }

  return null;
}

function findTrimmedMatch(
  fileLines: string[],
  contextLines: Array<{ text: string; kind: 'context' | 'remove' }>,
): number | null {
  if (contextLines.length === 0) return 0;

  for (let startIdx = 0; startIdx <= fileLines.length - contextLines.length; startIdx++) {
    let allMatch = true;
    for (let i = 0; i < contextLines.length; i++) {
      const fileLine = fileLines[startIdx + i];
      const contextLine = contextLines[i];
      if (!fileLine || !contextLine) {
        allMatch = false;
        break;
      }
      const trimmedFile = fileLine.trim();
      const trimmedContext = contextLine.text.trim();
      if (trimmedFile !== trimmedContext) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return startIdx;
    }
  }

  return null;
}

// ============================================================================
// Applier Implementation
// ============================================================================

async function applyOperations(
  operations: PatchOperation[],
  env: ExecutionEnvironment,
): Promise<string> {
  const results: string[] = [];

  for (const op of operations) {
    if (op.kind === 'add') {
      await env.writeFile(op.path, op.content);
      results.push(`Added ${op.path}`);
    } else if (op.kind === 'delete') {
      const exists = await env.fileExists(op.path);
      if (!exists) {
        return `Error: File to delete does not exist: ${op.path}`;
      }
      await env.deleteFile(op.path);
      results.push(`Deleted ${op.path}`);
    } else if (op.kind === 'update') {
      const fileContent = await env.readFile(op.path);
      const fileLines = fileContent.split('\n');

      let updatedLines = fileLines;
      for (const hunk of op.hunks) {
        const contextLines = hunk.lines.filter(
          (l) => l.kind === 'context' || l.kind === 'remove',
        ) as Array<{ text: string; kind: 'context' | 'remove' }>;

        const matchIdx = matchContext(updatedLines, contextLines);
        if (matchIdx === null) {
          return `Error: Could not find context for hunk in ${op.path}`;
        }

        const newLines: string[] = [];

        // Add all lines before the match
        for (let i = 0; i < matchIdx; i++) {
          const line = updatedLines[i];
          if (line !== undefined) {
            newLines.push(line);
          }
        }

        // Apply the hunk
        let contextOffset = 0;
        for (const hunkLine of hunk.lines) {
          if (hunkLine.kind === 'context') {
            newLines.push(hunkLine.text);
            contextOffset++;
          } else if (hunkLine.kind === 'remove') {
            contextOffset++;
          } else if (hunkLine.kind === 'add') {
            newLines.push(hunkLine.text);
          }
        }

        // Add all lines after the context match
        for (let i = matchIdx + contextOffset; i < updatedLines.length; i++) {
          const line = updatedLines[i];
          if (line !== undefined) {
            newLines.push(line);
          }
        }

        updatedLines = newLines;
      }

      const newContent = updatedLines.join('\n');
      const targetPath = op.moveTo || op.path;

      if (op.moveTo) {
        await env.deleteFile(op.path);
      }

      await env.writeFile(targetPath, newContent);
      const hunkCount = op.hunks.length;
      results.push(
        `Updated ${op.path}${op.moveTo ? ` -> ${op.moveTo}` : ''} (${hunkCount} hunk${hunkCount !== 1 ? 's' : ''})`,
      );
    }
  }

  return `Applied ${results.length} operation${results.length !== 1 ? 's' : ''}: ${results.join(', ')}`;
}

// ============================================================================
// Executor
// ============================================================================

export const applyPatchExecutor: ToolExecutor = async (args, env) => {
  const patch = args['patch'] as string | undefined;

  if (!patch || typeof patch !== 'string') {
    return 'Error: patch is required and must be a string';
  }

  try {
    const parseResult = parsePatch(patch);

    if (typeof parseResult === 'string') {
      return parseResult;
    }

    const result = await applyOperations(parseResult, env);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error applying patch: ${errorMessage}`;
  }
};

export function createApplyPatchTool(): RegisteredTool {
  return {
    definition: {
      name: 'apply_patch',
      description:
        'Apply a v4a format patch to files. Supports adding, deleting, and updating files with context-aware hunk matching.',
      parameters: {
        type: 'object' as const,
        properties: {
          patch: {
            type: 'string',
            description:
              'The patch text in v4a format (between *** Begin Patch and *** End Patch markers)',
          },
        },
        required: ['patch'],
      },
    },
    executor: applyPatchExecutor,
  };
}
