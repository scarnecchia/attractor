export type TruncationMode = 'head_tail' | 'tail';

export type TruncationConfig = {
  readonly toolOutputLimits?: Readonly<Record<string, number>>;
  readonly toolLineLimits?: Readonly<Record<string, number>>;
};

export const DEFAULT_CHAR_LIMITS: Readonly<Record<string, number>> = {
  read_file: 50_000,
  shell: 30_000,
  grep: 20_000,
  glob: 20_000,
  edit_file: 10_000,
  apply_patch: 10_000,
  write_file: 1_000,
  spawn_agent: 20_000,
};

export const DEFAULT_TRUNCATION_MODES: Readonly<Record<string, TruncationMode>> = {
  read_file: 'head_tail',
  shell: 'head_tail',
  grep: 'tail',
  glob: 'tail',
  edit_file: 'tail',
  apply_patch: 'tail',
  write_file: 'tail',
  spawn_agent: 'head_tail',
};

export const DEFAULT_LINE_LIMITS: Readonly<Record<string, number | null>> = {
  shell: 256,
  grep: 200,
  glob: 500,
  read_file: null,
  edit_file: null,
};

/**
 * Stage 1: Character-based truncation
 *
 * Two modes:
 * - head_tail: Keep first maxChars/2 + WARNING + last maxChars/2
 * - tail: Keep last maxChars with WARNING prefix
 *
 * Returns unchanged if output.length <= maxChars
 */
export function truncateChars(output: string, maxChars: number, mode: TruncationMode): string {
  if (output.length <= maxChars) {
    return output;
  }

  const removed = output.length - maxChars;

  if (mode === 'head_tail') {
    const halfSize = Math.floor(maxChars / 2);
    const warning = `\n\n[WARNING: Tool output was truncated. ${removed} characters were removed from the middle. The full output is available in the event stream. If you need to see specific parts, re-run the tool with more targeted parameters.]\n\n`;
    const firstHalf = output.slice(0, halfSize);
    const lastHalf = output.slice(output.length - halfSize);
    return firstHalf + warning + lastHalf;
  }

  // tail mode
  const warning = `[WARNING: Tool output was truncated. First ${removed} characters were removed. The full output is available in the event stream.]\n\n`;
  const tail = output.slice(output.length - maxChars);
  return warning + tail;
}

/**
 * Stage 2: Line-based truncation
 *
 * Uses head_tail split on lines.
 * If output has <= maxLines, returns unchanged.
 * Otherwise keeps first maxLines/2 + WARNING + last maxLines/2
 */
export function truncateLines(output: string, maxLines: number): string {
  const lines = output.split('\n');

  if (lines.length <= maxLines) {
    return output;
  }

  const removed = lines.length - maxLines;
  const halfSize = Math.floor(maxLines / 2);

  const firstHalf = lines.slice(0, halfSize);
  const lastHalf = lines.slice(lines.length - halfSize);

  const warning = `[WARNING: Tool output was truncated. ${removed} lines were removed from the middle.]\n`;

  return firstHalf.join('\n') + '\n' + warning + lastHalf.join('\n');
}

/**
 * Two-stage truncation pipeline
 *
 * Step 1: Character-based truncation (always first)
 * Step 2: Line-based truncation (where configured)
 */
export function truncateToolOutput(
  output: string,
  toolName: string,
  config?: TruncationConfig,
): string {
  // Determine character limit from config or default
  const charLimit = config?.toolOutputLimits?.[toolName] ?? DEFAULT_CHAR_LIMITS[toolName] ?? 30_000;

  // Determine truncation mode
  const mode = DEFAULT_TRUNCATION_MODES[toolName] ?? 'head_tail';

  // Step 1: Character truncation (always first)
  let result = truncateChars(output, charLimit, mode);

  // Step 2: Line truncation (where configured)
  const lineLimit = config?.toolLineLimits?.[toolName] ?? DEFAULT_LINE_LIMITS[toolName] ?? null;
  if (lineLimit !== null) {
    result = truncateLines(result, lineLimit);
  }

  return result;
}
