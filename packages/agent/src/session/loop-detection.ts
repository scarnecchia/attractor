export type LoopDetector = {
  readonly record: (toolName: string, argsHash: string) => void;
  readonly check: () => string | null;
  readonly reset: () => void;
};

export function createLoopDetector(windowSize: number = 10): LoopDetector {
  const signatures: string[] = [];

  function getSignature(toolName: string, argsHash: string): string {
    return `${toolName}:${argsHash}`;
  }

  function detectPattern(): string | null {
    if (signatures.length < 2) {
      return null;
    }

    // Pattern length 1: same signature repeated 5+ times
    if (signatures.length >= 5) {
      const last = signatures[signatures.length - 1];
      let count = 0;
      for (let i = signatures.length - 1; i >= 0; i--) {
        if (signatures[i] === last) {
          count++;
        } else {
          break;
        }
      }
      if (count >= 5) {
        return `Detected repeating loop: tool call '${last}' repeated ${count} times`;
      }
    }

    // Pattern length 2: alternating pair (A,B,A,B,A,B...)
    if (signatures.length >= 6) {
      const a = signatures[signatures.length - 2];
      const b = signatures[signatures.length - 1];

      if (a !== b) {
        let pairCount = 1;

        // Check backwards: for alternating pairs
        // We have a,b at positions (len-2, len-1)
        // Next pair back would be at (len-4, len-3), (len-6, len-5), etc
        for (let i = signatures.length - 4; i >= 0; i -= 2) {
          if (signatures[i] === a && signatures[i + 1] === b) {
            pairCount++;
          } else {
            break;
          }
        }

        if (pairCount >= 3) {
          return `Detected repeating pattern: '${a}' and '${b}' alternating`;
        }
      }
    }

    // Pattern length 3: repeating triple (A,B,C,A,B,C,A,B,C...)
    if (signatures.length >= 9) {
      const a = signatures[signatures.length - 3];
      const b = signatures[signatures.length - 2];
      const c = signatures[signatures.length - 1];

      if (a !== b && b !== c && a !== c) {
        let tripleCount = 1;

        // Check backwards: for repeating triples
        // We have a,b,c at positions (len-3, len-2, len-1)
        // Next triple back would be at (len-6, len-5, len-4), (len-9, len-8, len-7), etc
        for (let i = signatures.length - 6; i >= 0; i -= 3) {
          if (signatures[i] === a && signatures[i + 1] === b && signatures[i + 2] === c) {
            tripleCount++;
          } else {
            break;
          }
        }

        if (tripleCount >= 2) {
          return `Detected repeating pattern: '${a}', '${b}', and '${c}' repeating`;
        }
      }
    }

    return null;
  }

  return {
    record: (toolName: string, argsHash: string) => {
      const sig = getSignature(toolName, argsHash);
      signatures.push(sig);

      if (signatures.length > windowSize) {
        signatures.shift();
      }
    },

    check: (): string | null => {
      return detectPattern();
    },

    reset: () => {
      signatures.length = 0;
    },
  };
}
