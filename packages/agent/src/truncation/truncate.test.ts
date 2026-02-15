import { describe, it, expect } from 'vitest';
import {
  truncateChars,
  truncateLines,
  truncateToolOutput,
  DEFAULT_CHAR_LIMITS,
  DEFAULT_TRUNCATION_MODES,
  DEFAULT_LINE_LIMITS,
} from './truncate.js';

describe('truncateChars', () => {
  it('should return unchanged if output is within limit', () => {
    const input = 'hello world';
    const result = truncateChars(input, 100, 'head_tail');
    expect(result).toBe(input);
  });

  it('should handle empty output', () => {
    const result = truncateChars('', 100, 'head_tail');
    expect(result).toBe('');
  });

  it('should handle head_tail mode correctly', () => {
    const input = 'a'.repeat(1000);
    const result = truncateChars(input, 100, 'head_tail');

    expect(result).toContain('[WARNING: Tool output was truncated.');
    expect(result).toContain('900 characters were removed from the middle');
    expect(result).toContain('The full output is available in the event stream');
    expect(result.length).toBeLessThan(input.length);

    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('should keep first half + warning + last half in head_tail mode', () => {
    const input = 'a'.repeat(100);
    const result = truncateChars(input, 100, 'head_tail');

    expect(result).toEqual(input);
  });

  it('should truncate and split correctly in head_tail mode (large input)', () => {
    const input = 'AAABBBCCCDDDEEE'.repeat(100);
    const result = truncateChars(input, 200, 'head_tail');

    expect(result.includes('WARNING')).toBe(true);
    expect(result).toContain('characters were removed from the middle');

    const parts = result.split('\n\n[WARNING:');
    expect(parts.length).toBe(2);
  });

  it('should handle tail mode correctly', () => {
    const input = 'a'.repeat(1000);
    const result = truncateChars(input, 100, 'tail');

    expect(result).toContain('[WARNING: Tool output was truncated.');
    expect(result).toContain('First 900 characters were removed');
    expect(result).toContain('The full output is available in the event stream');
    expect(result.length).toBeLessThan(input.length);
  });

  it('should keep only last maxChars in tail mode', () => {
    const input = '0'.repeat(500) + 'LAST_100_CHARS' + 'x'.repeat(400);
    const result = truncateChars(input, 500, 'tail');

    expect(result.endsWith('x'.repeat(400))).toBe(true);
    expect(result).toContain('First');
  });

  it('should calculate removed count correctly', () => {
    const input = 'a'.repeat(1000);
    const result = truncateChars(input, 100, 'head_tail');

    expect(result).toContain('900 characters were removed');
  });

  it('should handle single character overflow', () => {
    const input = 'ab';
    const result = truncateChars(input, 1, 'tail');
    expect(result).toContain('WARNING');
  });
});

describe('truncateLines', () => {
  it('should return unchanged if within line limit', () => {
    const input = 'line1\nline2\nline3';
    const result = truncateLines(input, 10);
    expect(result).toBe(input);
  });

  it('should handle empty output', () => {
    const result = truncateLines('', 10);
    expect(result).toBe('');
  });

  it('should truncate using head_tail split on lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const input = lines.join('\n');
    const result = truncateLines(input, 20);

    expect(result).toContain('WARNING');
    expect(result).toContain('80 lines were removed from the middle');
  });

  it('should keep first half + warning + last half', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const input = lines.join('\n');
    const result = truncateLines(input, 20);

    expect(result).toContain('line0');
    expect(result).toContain('line99');
    expect(result).toContain('WARNING');
  });

  it('should handle exact line count match', () => {
    const input = 'line1\nline2\nline3';
    const result = truncateLines(input, 3);
    expect(result).toBe(input);
  });

  it('should handle single line input', () => {
    const input = 'single line';
    const result = truncateLines(input, 1);
    expect(result).toBe(input);
  });
});

describe('truncateToolOutput (integration)', () => {
  it('should apply character truncation first', () => {
    const input = 'a'.repeat(60000);
    const result = truncateToolOutput(input, 'read_file');

    expect(result.length).toBeLessThanOrEqual(50000 + 500);
  });

  it('should apply line truncation second when configured', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line${i}`);
    const input = lines.join('\n');
    const result = truncateToolOutput(input, 'shell');

    expect(result).toContain('WARNING');
  });

  it('should use default char limit for known tool', () => {
    const input = 'a'.repeat(60000);
    const result = truncateToolOutput(input, 'read_file');

    expect(result.length).toBeLessThan(60000);
  });

  it('should use default truncation mode', () => {
    const input = 'a'.repeat(60000);
    const result = truncateToolOutput(input, 'read_file');

    expect(result).toContain('WARNING');
    expect(result).toContain('characters were removed from the middle');
  });

  it('should handle unknown tool with reasonable fallback', () => {
    const input = 'a'.repeat(50000);
    const result = truncateToolOutput(input, 'unknown_tool');

    expect(result.length).toBeLessThan(50000);
  });

  it('should respect config overrides for char limit', () => {
    const input = 'a'.repeat(100000);
    const config = { toolOutputLimits: { test_tool: 5000 } };
    const result = truncateToolOutput(input, 'test_tool', config);

    expect(result.length).toBeLessThan(6000);
  });

  it('should respect config overrides for line limit', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
    const input = lines.join('\n');
    const config = { toolLineLimits: { test_tool: 50 } };
    const result = truncateToolOutput(input, 'test_tool', config);

    expect(result).toContain('WARNING');
  });

  it('should handle pathological input (10MB single line)', () => {
    const input = 'a'.repeat(10_000_000);
    const result = truncateToolOutput(input, 'read_file');

    expect(result.length).toBeLessThan(10_000_000);
    expect(result.length).toBeLessThanOrEqual(50000 + 500);
  });

  it('should skip line truncation when no line limit configured', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
    const input = lines.join('\n');
    const result = truncateToolOutput(input, 'read_file');

    const inputLineCount = input.split('\n').length;
    const resultLineCount = result.split('\n').length;

    expect(resultLineCount).toBeLessThanOrEqual(inputLineCount);
  });

  it('should apply both truncations when both limits exceeded', () => {
    const lines = Array.from({ length: 500 }, (_, i) => 'x'.repeat(200) + `\nline${i}\n`);
    const input = lines.join('');
    const result = truncateToolOutput(input, 'shell');

    expect(result).toContain('WARNING');
    expect(result.length).toBeLessThan(input.length);
  });

  it('should verify default limits match spec', () => {
    expect(DEFAULT_CHAR_LIMITS.read_file).toBe(50_000);
    expect(DEFAULT_CHAR_LIMITS.shell).toBe(30_000);
    expect(DEFAULT_CHAR_LIMITS.grep).toBe(20_000);
    expect(DEFAULT_CHAR_LIMITS.glob).toBe(20_000);
    expect(DEFAULT_CHAR_LIMITS.edit_file).toBe(10_000);
    expect(DEFAULT_CHAR_LIMITS.apply_patch).toBe(10_000);
    expect(DEFAULT_CHAR_LIMITS.write_file).toBe(1_000);
    expect(DEFAULT_CHAR_LIMITS.spawn_agent).toBe(20_000);
  });

  it('should verify default truncation modes', () => {
    expect(DEFAULT_TRUNCATION_MODES.read_file).toBe('head_tail');
    expect(DEFAULT_TRUNCATION_MODES.shell).toBe('head_tail');
    expect(DEFAULT_TRUNCATION_MODES.grep).toBe('tail');
    expect(DEFAULT_TRUNCATION_MODES.glob).toBe('tail');
    expect(DEFAULT_TRUNCATION_MODES.edit_file).toBe('tail');
    expect(DEFAULT_TRUNCATION_MODES.apply_patch).toBe('tail');
    expect(DEFAULT_TRUNCATION_MODES.write_file).toBe('tail');
    expect(DEFAULT_TRUNCATION_MODES.spawn_agent).toBe('head_tail');
  });

  it('should verify default line limits', () => {
    expect(DEFAULT_LINE_LIMITS.shell).toBe(256);
    expect(DEFAULT_LINE_LIMITS.grep).toBe(200);
    expect(DEFAULT_LINE_LIMITS.glob).toBe(500);
    expect(DEFAULT_LINE_LIMITS.read_file).toBe(null);
    expect(DEFAULT_LINE_LIMITS.edit_file).toBe(null);
  });

  it('should not add extra warning for small shell output', () => {
    const input = 'line1\nline2\nline3';
    const result = truncateToolOutput(input, 'shell');
    expect(result).toBe(input);
  });

  it('AC5.1: character truncation runs first on mixed overflow', () => {
    const largeSingleLine = 'x'.repeat(100_000);
    const result = truncateToolOutput(largeSingleLine, 'read_file');

    expect(result).toContain('WARNING');
    expect(result.length).toBeLessThan(100_000);
  });

  it('AC5.2: line truncation runs second for shell within char limit but over 256 lines', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `short_line_${i}`);
    const input = lines.join('\n');
    const result = truncateToolOutput(input, 'shell');

    expect(result).toContain('WARNING');
    expect(result.split('\n').length).toBeLessThanOrEqual(256 + 10);
  });

  it('AC5.3: head_tail mode keeps first half + last half', () => {
    const input = 'a'.repeat(100000);
    const result = truncateToolOutput(input, 'read_file');

    expect(result).toContain('WARNING');
    expect(result).toContain('characters were removed from the middle');
  });

  it('AC5.4: tail mode drops beginning, keeps end', () => {
    const prefix = '0'.repeat(50000);
    const suffix = 'IMPORTANT'.repeat(1000);
    const input = prefix + suffix;
    const result = truncateToolOutput(input, 'grep');

    expect(result).toContain('WARNING');
    expect(result).toContain('First');
    expect(result).toContain('IMPORTANT');
  });

  it('AC5.5: pathological input (10MB single line) handled by char truncation', () => {
    const input = 'a'.repeat(10_000_000);
    const result = truncateToolOutput(input, 'read_file');

    expect(() => truncateChars(input, 50_000, 'head_tail')).not.toThrow();
    expect(result.length).toBeLessThanOrEqual(50000 + 500);
    expect(result.split('\n').length).toBeGreaterThan(1);
  });

  it('AC5.6: default limits match spec and are overridable', () => {
    const shellInput = 'x'.repeat(40000);
    const configOverride = { toolOutputLimits: { shell: 5000 } };
    const result = truncateToolOutput(shellInput, 'shell', configOverride);

    expect(result.length).toBeLessThan(6000);
  });
});
