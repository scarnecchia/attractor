import { describe, test, expect } from 'vitest';
import { createContextTracker } from './context-tracking.js';

describe('createContextTracker', () => {
  test('returns null when tracking is disabled (no contextWindowSize)', () => {
    const tracker = createContextTracker(undefined);

    tracker.record(1000);
    tracker.record(1000);

    expect(tracker.check()).toBeNull();
  });

  test('returns null when usage is below warning threshold', () => {
    // contextWindowSize = 1000 tokens = 4000 chars
    // warningThreshold = 0.8 (80%) = 3200 chars
    const tracker = createContextTracker(1000, 0.8);

    // Record 3000 chars = 75% usage (below 80%)
    tracker.record(3000);

    expect(tracker.check()).toBeNull();
  });

  test('returns usagePercent when at warning threshold (80%)', () => {
    const tracker = createContextTracker(1000, 0.8);

    // Record 3200 chars = exactly 80% of 4000 char budget
    tracker.record(3200);

    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.8, 5);
  });

  test('returns usagePercent above warning threshold', () => {
    const tracker = createContextTracker(1000, 0.8);

    // Record 3500 chars = 87.5% usage
    tracker.record(3500);

    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.875, 5);
  });

  test('returns 1.0 (100%) when context window is full', () => {
    const tracker = createContextTracker(1000, 0.8);

    // Record 4000 chars = exactly 100% of 4000 char budget
    tracker.record(4000);

    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(1.0, 5);
  });

  test('returns totalChars accumulating across multiple records', () => {
    const tracker = createContextTracker(1000, 0.8);

    tracker.record(1000);
    expect(tracker.totalChars()).toBe(1000);

    tracker.record(1500);
    expect(tracker.totalChars()).toBe(2500);

    tracker.record(500);
    expect(tracker.totalChars()).toBe(3000);
  });

  test('resets totalChars to zero', () => {
    const tracker = createContextTracker(1000, 0.8);

    tracker.record(2000);
    expect(tracker.totalChars()).toBe(2000);

    tracker.reset();
    expect(tracker.totalChars()).toBe(0);
    expect(tracker.check()).toBeNull();
  });

  test('respects custom warning threshold', () => {
    const tracker = createContextTracker(1000, 0.5);

    // Record 1000 chars = 25% usage (below 50% threshold)
    tracker.record(1000);
    expect(tracker.check()).toBeNull();

    // Record 1000 more = 50% usage (at threshold)
    tracker.record(1000);
    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.5, 5);
  });

  test('works with small context windows', () => {
    const tracker = createContextTracker(100, 0.8);

    // contextWindowSize = 100 tokens = 400 chars
    // 80% threshold = 320 chars

    tracker.record(320);
    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.8, 5);
  });

  test('works with large context windows', () => {
    const tracker = createContextTracker(100000, 0.8);

    // contextWindowSize = 100000 tokens = 400000 chars
    // 80% threshold = 320000 chars

    tracker.record(320000);
    const result = tracker.check();
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.8, 5);
  });

  test('handles zero warning threshold', () => {
    const tracker = createContextTracker(1000, 0);

    // Any usage >= 0 should trigger warning
    tracker.record(1);
    const result = tracker.check();
    expect(result).not.toBeNull();
  });
});
