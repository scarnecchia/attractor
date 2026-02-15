import { describe, it, expect } from 'vitest';
import { createLoopDetector } from './loop-detection.js';

describe('LoopDetector', () => {
  describe('pattern length 1: repeating single call', () => {
    it('should detect same call repeated 5+ times', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 5; i++) {
        detector.record('read', 'hash1');
      }

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('read:hash1');
      expect(result).toContain('repeated 5');
    });

    it('should not detect fewer than 5 repetitions', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 4; i++) {
        detector.record('read', 'hash1');
      }

      const result = detector.check();
      expect(result).toBeNull();
    });

    it('should detect 10+ repetitions', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 10; i++) {
        detector.record('write', 'hash2');
      }

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('write:hash2');
    });
  });

  describe('pattern length 2: alternating pair', () => {
    it('should detect A,B,A,B,A,B pattern', () => {
      const detector = createLoopDetector();

      const pattern = ['read', 'write', 'read', 'write', 'read', 'write'];
      pattern.forEach((tool) => {
        detector.record(tool, 'hash1');
      });

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('alternating');
    });

    it('should not detect alternating with fewer than 3 pairs', () => {
      const detector = createLoopDetector();

      const pattern = ['read', 'write', 'read', 'write'];
      pattern.forEach((tool) => {
        detector.record(tool, 'hash1');
      });

      const result = detector.check();
      expect(result).toBeNull();
    });

    it('should detect alternating pair with different args', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('read', 'hash1');
      detector.record('write', 'hash2');

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('alternating');
    });

    it('should not detect broken alternating pattern', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('read', 'hash1');
      detector.record('grep', 'hash3'); // breaks pattern

      const result = detector.check();
      expect(result).toBeNull();
    });
  });

  describe('pattern length 3: repeating triple', () => {
    it('should detect A,B,C,A,B,C,A,B,C pattern', () => {
      const detector = createLoopDetector();

      const pattern = [
        'read',
        'write',
        'grep',
        'read',
        'write',
        'grep',
        'read',
        'write',
        'grep',
      ];
      pattern.forEach((tool) => {
        detector.record(tool, 'hash1');
      });

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('repeating');
    });

    it('should not detect repeating triple with fewer than 2 cycles', () => {
      const detector = createLoopDetector();

      const pattern = ['read', 'write', 'grep', 'read', 'write', 'grep'];
      pattern.forEach((tool) => {
        detector.record(tool, 'hash1');
      });

      const result = detector.check();
      expect(result).toBeNull();
    });

    it('should detect triple pattern with different args', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('grep', 'hash3');
      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('grep', 'hash3');
      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('grep', 'hash3');

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('repeating');
    });

    it('should not detect broken repeating triple', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('grep', 'hash3');
      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('shell', 'hash4'); // breaks pattern

      const result = detector.check();
      expect(result).toBeNull();
    });
  });

  describe('non-repeating sequences', () => {
    it('should return null for random sequence', () => {
      const detector = createLoopDetector();

      const tools = ['read', 'write', 'grep', 'shell', 'edit', 'glob'];
      tools.forEach((tool) => {
        detector.record(tool, 'hash1');
      });

      const result = detector.check();
      expect(result).toBeNull();
    });

    it('should return null for empty detector', () => {
      const detector = createLoopDetector();

      const result = detector.check();
      expect(result).toBeNull();
    });

    it('should return null for single entry', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');

      const result = detector.check();
      expect(result).toBeNull();
    });
  });

  describe('reset', () => {
    it('should clear history on reset', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 5; i++) {
        detector.record('read', 'hash1');
      }

      let result = detector.check();
      expect(result).not.toBeNull();

      detector.reset();
      result = detector.check();
      expect(result).toBeNull();
    });

    it('should allow fresh detection after reset', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 5; i++) {
        detector.record('read', 'hash1');
      }

      detector.reset();

      for (let i = 0; i < 5; i++) {
        detector.record('write', 'hash2');
      }

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('write:hash2');
    });
  });

  describe('window size', () => {
    it('should respect custom window size', () => {
      const detector = createLoopDetector(3);

      detector.record('read', 'hash1');
      detector.record('write', 'hash2');
      detector.record('grep', 'hash3');
      detector.record('shell', 'hash4');

      // Should only contain the last 3 entries
      const result = detector.check();
      expect(result).toBeNull(); // No pattern from write, grep, shell
    });

    it('should drop old entries when exceeding window size', () => {
      const detector = createLoopDetector(5);

      // Record beyond window - create a pattern with a,a,a,a,a,b,b,b,b,b
      detector.record('a', 'h1');
      detector.record('a', 'h1');
      detector.record('a', 'h1');
      detector.record('a', 'h1');
      detector.record('a', 'h1');
      detector.record('b', 'h2');
      detector.record('b', 'h2');
      detector.record('b', 'h2');
      detector.record('b', 'h2');
      detector.record('b', 'h2');

      // With window size 5, we only keep the last 5: b,b,b,b,b
      // This should trigger pattern length 1
      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('b:h2');
    });

    it('should use default window size of 10', () => {
      const detector = createLoopDetector();

      for (let i = 0; i < 15; i++) {
        detector.record('tool', 'hash1');
      }

      // With window 10, should still detect even with 15 entries
      const result = detector.check();
      expect(result).not.toBeNull();
    });
  });

  describe('different tool names and args', () => {
    it('should distinguish different tool names', () => {
      const detector = createLoopDetector();

      detector.record('write', 'samehash');
      detector.record('write', 'samehash');
      detector.record('write', 'samehash');
      detector.record('write', 'samehash');
      detector.record('write', 'samehash');

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('write:samehash');
    });

    it('should distinguish different args for same tool', () => {
      const detector = createLoopDetector();

      detector.record('read', 'hash1');
      detector.record('read', 'hash2');
      detector.record('read', 'hash1');
      detector.record('read', 'hash2');
      detector.record('read', 'hash1');
      detector.record('read', 'hash2');

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('alternating');
    });

    it('should treat same tool with different args as different signature', () => {
      const detector = createLoopDetector();

      // Same tool, different args should not match
      detector.record('read', 'fileA');
      detector.record('read', 'fileB');
      detector.record('read', 'fileA');
      detector.record('read', 'fileB');
      detector.record('read', 'fileA');
      detector.record('read', 'fileB');

      const result = detector.check();
      expect(result).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle very long repeating sequence', () => {
      const detector = createLoopDetector(20);

      for (let i = 0; i < 15; i++) {
        detector.record('read', 'hash1');
      }

      const result = detector.check();
      expect(result).not.toBeNull();
      expect(result).toContain('15');
    });

    it('should prioritize longer patterns', () => {
      const detector = createLoopDetector();

      // A,B,C,A,B,C,A,B,C (triple pattern 3 times)
      detector.record('a', 'h1');
      detector.record('b', 'h2');
      detector.record('c', 'h3');
      detector.record('a', 'h1');
      detector.record('b', 'h2');
      detector.record('c', 'h3');
      detector.record('a', 'h1');
      detector.record('b', 'h2');
      detector.record('c', 'h3');

      const result = detector.check();
      expect(result).not.toBeNull();
      // Should detect the triple pattern
      expect(result).toContain('repeating');
    });
  });
});
