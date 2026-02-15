export type ContextTracker = {
  readonly record: (chars: number) => void;
  readonly check: () => number | null;
  readonly totalChars: () => number;
  readonly reset: () => void;
};

export function createContextTracker(
  contextWindowSize: number | undefined,
  warningThreshold: number = 0.8,
): ContextTracker {
  let totalCharacters = 0;

  // Heuristic: 1 token ≈ 4 characters
  const contextWindowChars = contextWindowSize !== undefined ? contextWindowSize * 4 : null;

  function record(chars: number): void {
    totalCharacters += chars;
  }

  function check(): number | null {
    // If tracking is disabled, return null
    if (contextWindowChars === null) {
      return null;
    }

    const usagePercent = totalCharacters / contextWindowChars;

    // Return usagePercent only if >= warningThreshold, otherwise null
    if (usagePercent >= warningThreshold) {
      return usagePercent;
    }

    return null;
  }

  function totalChars(): number {
    return totalCharacters;
  }

  function reset(): void {
    totalCharacters = 0;
  }

  return {
    record,
    check,
    totalChars,
    reset,
  };
}
