import { describe, it, expect } from 'vitest';
import {
  applyPatchExecutor,
  createApplyPatchTool,
  parsePatch,
} from './apply-patch.js';
import type { ExecutionEnvironment } from '../types/index.js';

function createMockEnv(): {
  env: ExecutionEnvironment;
  files: Record<string, string>;
  deletedFiles: Set<string>;
} {
  const files: Record<string, string> = {};
  const deletedFiles = new Set<string>();

  return {
    files,
    deletedFiles,
    env: {
      readFile: async (path) => {
        if (deletedFiles.has(path)) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return content;
      },
      writeFile: async (path, content) => {
        files[path] = content;
        deletedFiles.delete(path);
      },
      deleteFile: async (path) => {
        deletedFiles.add(path);
        delete files[path];
      },
      fileExists: async (path) => {
        return !deletedFiles.has(path) && path in files;
      },
      listDirectory: async () => [],
      execCommand: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      }),
      grep: async () => '',
      glob: async () => [],
      initialize: async () => {},
      cleanup: async () => {},
      workingDirectory: () => '/tmp',
      platform: () => 'darwin',
      osVersion: () => '25.1.0',
    },
  };
}

function assertIsArray(result: unknown): asserts result is Array<unknown> {
  expect(Array.isArray(result)).toBe(true);
}

describe('apply-patch tool', () => {
  describe('tool definition', () => {
    it('should have correct name and description', () => {
      const tool = createApplyPatchTool();
      expect(tool.definition.name).toBe('apply_patch');
      expect(tool.definition.description).toContain('v4a format');
    });

    it('should have correct parameters schema', () => {
      const tool = createApplyPatchTool();
      const params = tool.definition.parameters;
      expect(params['properties']).toHaveProperty('patch');
      expect(params['required']).toContain('patch');
    });
  });

  describe('parsePatch', () => {
    it('should parse Add File operation', () => {
      const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const hello = 'world';
*** End Patch`;

      const result = parsePatch(patch);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        kind: 'add',
        path: 'src/new.ts',
        content: "export const hello = 'world';",
      });
    });

    it('should parse Delete File operation', () => {
      const patch = `*** Begin Patch
*** Delete File: src/old.ts
*** End Patch`;

      const result = parsePatch(patch);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        kind: 'delete',
        path: 'src/old.ts',
      });
    });

    it('should parse Update File with single hunk', () => {
      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log('old');
+  console.log('new');
 }
*** End Patch`;

      const result = parsePatch(patch);
      assertIsArray(result);
      expect(result).toHaveLength(1);

      const op = result[0];
      expect(op).toBeDefined();
      if (op) {
        expect(op.kind).toBe('update');
        if (op.kind === 'update') {
          expect(op.path).toBe('src/main.ts');
          expect(op.hunks).toHaveLength(1);
          const firstHunk = op.hunks[0];
          if (firstHunk) {
            expect(firstHunk.lines).toHaveLength(4);
          }
        }
      }
    });

    it('should parse Update File with multiple hunks', () => {
      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log('old1');
+  console.log('new1');
 }
@@ -10,3 +10,3 @@
 function goodbye() {
-  console.log('old2');
+  console.log('new2');
 }
*** End Patch`;

      const result = parsePatch(patch);
      assertIsArray(result);

      const op = result[0];
      expect(op).toBeDefined();
      if (op) {
        expect(op.kind).toBe('update');
        if (op.kind === 'update') {
          expect(op.hunks).toHaveLength(2);
        }
      }
    });

    it('should parse Update File with Move To', () => {
      const patch = `*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@ -1,1 +1,1 @@
 hello
+world
*** End Patch`;

      const result = parsePatch(patch);
      assertIsArray(result);

      const op = result[0];
      expect(op).toBeDefined();
      if (op) {
        expect(op.kind).toBe('update');
        if (op.kind === 'update') {
          expect(op.path).toBe('src/old.ts');
          expect(op.moveTo).toBe('src/new.ts');
        }
      }
    });

    it('should parse multi-file patch', () => {
      const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const x = 1;
*** Update File: src/main.ts
@@ -1,1 +1,1 @@
 hello
-world
+universe
*** Delete File: src/old.ts
*** End Patch`;

      const result = parsePatch(patch);
      assertIsArray(result);
      expect(result).toHaveLength(3);
      expect(result[0]).toBeDefined();
      expect(result[1]).toBeDefined();
      expect(result[2]).toBeDefined();
      if (result[0]) expect(result[0].kind).toBe('add');
      if (result[1]) expect(result[1].kind).toBe('update');
      if (result[2]) expect(result[2].kind).toBe('delete');
    });

    it('should return error for missing Begin Patch marker', () => {
      const patch = '*** End Patch';
      const result = parsePatch(patch);
      expect(typeof result).toBe('string');
      expect(result).toContain('Missing "*** Begin Patch"');
    });

    it('should return error for missing End Patch marker', () => {
      const patch = '*** Begin Patch\n*** Add File: test.ts\n+content';
      const result = parsePatch(patch);
      expect(typeof result).toBe('string');
      expect(result).toContain('Missing "*** End Patch"');
    });
  });

  describe('context matching', () => {
    it('should match exact context', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'function hello() {\n  console.log("old");\n}';

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old");
+  console.log("new");
 }
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated');
      expect(files['src/main.ts']).toContain('console.log("new")');
    });

    it('should match whitespace-trimmed context', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'function hello() {\n  console.log("old");\n}';

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old");
+  console.log("new");
 }
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated');
    });

    it('should return error when context not found', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'something completely different';

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old");
+  console.log("new");
 }
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Error');
      expect(result).toContain('Could not find context');
    });
  });

  describe('end-to-end operations', () => {
    it('should add a new file', async () => {
      const { env, files } = createMockEnv();

      const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const hello = 'world';
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Added src/new.ts');
      expect(files['src/new.ts']).toBe("export const hello = 'world';");
    });

    it('should delete an existing file', async () => {
      const { env, files, deletedFiles } = createMockEnv();
      files['src/old.ts'] = 'old content';

      const patch = `*** Begin Patch
*** Delete File: src/old.ts
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Deleted src/old.ts');
      expect(deletedFiles.has('src/old.ts')).toBe(true);
    });

    it('should update a file with single hunk', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'function hello() {\n  console.log("old");\n}';

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old");
+  console.log("new");
 }
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated src/main.ts');
      expect(files['src/main.ts']).toContain('console.log("new")');
      expect(files['src/main.ts']).not.toContain('console.log("old")');
    });

    it('should update a file with multiple hunks', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = `function hello() {
  console.log("old1");
}

function goodbye() {
  console.log("old2");
}`;

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old1");
+  console.log("new1");
 }
@@ -5,3 +5,3 @@
 function goodbye() {
-  console.log("old2");
+  console.log("new2");
 }
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated src/main.ts (2 hunks)');
      expect(files['src/main.ts']).toContain('console.log("new1")');
      expect(files['src/main.ts']).toContain('console.log("new2")');
    });

    it('should handle Update with Move (rename)', async () => {
      const { env, files, deletedFiles } = createMockEnv();
      files['src/old.ts'] = 'hello\nworld';

      const patch = `*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@ -1,2 +1,2 @@
 hello
-world
+universe
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated src/old.ts -> src/new.ts');
      expect(deletedFiles.has('src/old.ts')).toBe(true);
      expect(files['src/new.ts']).toBe('hello\nuniverse');
    });

    it('should apply multi-file patch', async () => {
      const { env, files, deletedFiles } = createMockEnv();
      files['src/main.ts'] = 'function hello() {}\n';
      files['src/old.ts'] = 'old';

      const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const x = 1;
*** Update File: src/main.ts
@@ -1,1 +1,2 @@
 function hello() {}
+function world() {}
*** Delete File: src/old.ts
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Applied 3 operations');
      expect(files['src/new.ts']).toBe('export const x = 1;');
      expect(files['src/main.ts']).toContain('function world() {}');
      expect(deletedFiles.has('src/old.ts')).toBe(true);
    });

    it('should return error when delete target does not exist', async () => {
      const { env } = createMockEnv();

      const patch = `*** Begin Patch
*** Delete File: src/nonexistent.ts
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Error');
      expect(result).toContain('does not exist');
    });
  });

  describe('applyPatchExecutor', () => {
    it('should handle missing patch argument', async () => {
      const { env } = createMockEnv();
      const result = await applyPatchExecutor({}, env);
      expect(result).toContain('Error');
      expect(result).toContain('patch is required');
    });

    it('should handle invalid patch format', async () => {
      const { env } = createMockEnv();
      const result = await applyPatchExecutor({ patch: 'invalid' }, env);
      expect(result).toContain('Error');
    });

    it('should catch executor errors', async () => {
      const { env } = createMockEnv();
      const result = await applyPatchExecutor(
        {
          patch: `*** Begin Patch
*** Update File: nonexistent.ts
@@ -1,1 +1,1 @@
 hello
-old
+new
*** End Patch`,
        },
        env,
      );
      expect(result).toContain('Error');
    });
  });

  describe('edge cases', () => {
    it('should handle Add File with empty content', async () => {
      const { env, files } = createMockEnv();

      const patch = `*** Begin Patch
*** Add File: src/empty.ts
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Added');
      expect(files['src/empty.ts']).toBe('');
    });

    it('should handle Add File with multi-line content', async () => {
      const { env, files } = createMockEnv();

      const patch = `*** Begin Patch
*** Add File: src/multi.ts
+line 1
+line 2
+line 3
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Added');
      expect(files['src/multi.ts']).toBe('line 1\nline 2\nline 3');
    });

    it('should handle blank lines in patches', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'hello\n\nworld';

      // Note: blank context line must be a space character
      const patch = '*** Begin Patch\n*** Update File: src/main.ts\n@@ -1,3 +1,3 @@\n hello\n \n-world\n+universe\n*** End Patch';

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated');
      expect(files['src/main.ts']).toBe('hello\n\nuniverse');
    });

    it('should handle multiple consecutive additions in hunk', async () => {
      const { env, files } = createMockEnv();
      files['src/main.ts'] = 'function hello() {}';

      const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ -1,1 +1,4 @@
 function hello() {}
+function a() {}
+function b() {}
+function c() {}
*** End Patch`;

      const result = await applyPatchExecutor({ patch }, env);
      expect(result).toContain('Updated');
      expect(files['src/main.ts']).toContain('function a()');
      expect(files['src/main.ts']).toContain('function b()');
      expect(files['src/main.ts']).toContain('function c()');
    });
  });
});
