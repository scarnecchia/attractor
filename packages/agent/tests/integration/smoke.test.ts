import { describe, test, beforeEach, afterEach, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@attractor/llm';
import { createAnthropicProfile } from '../../src/profiles/anthropic/index.js';
import { createSession } from '../../src/session/session.js';
import { createLocalExecutionEnvironment } from '../../src/execution/local.js';
import type { SessionConfig } from '../../src/types/index.js';
import { hasAnthropicKey, ANTHROPIC_MODEL } from './helpers.js';

describe.skipIf(!hasAnthropicKey())('Anthropic Integration Smoke Tests', () => {
  let tempDir: string;
  let client: Client;
  let config: SessionConfig;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-test-'));

    // Create a real Client with Anthropic provider
    const { getDefaultClient } = await import('@attractor/llm');
    client = getDefaultClient();

    config = {
      model: ANTHROPIC_MODEL,
      provider: 'anthropic',
      maxToolRoundsPerInput: 5,
      maxTurns: 20,
    };
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test(
    'Scenario 1: File creation',
    async () => {
      const profile = createAnthropicProfile();
      const environment = createLocalExecutionEnvironment(tempDir);
      const session = createSession({ profile, environment, client, config });

      const events: Array<any> = [];
      const eventIterator = session.events();

      // Collect events in background
      const collectPromise = (async () => {
        for await (const event of eventIterator) {
          events.push(event);
          if (event.kind === 'SESSION_END') {
            break;
          }
        }
      })();

      // Submit input
      await session.submit("Create a file called hello.txt with 'Hello, World!'");

      // Wait for collection
      await collectPromise;

      // Verify file was created
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(tempDir, 'hello.txt'), 'utf-8');
      expect(content).toBe('Hello, World!');

      // Verify events include TOOL_CALL_START/END for write_file
      const hasWriteFileCall = events.some(
        (e) => e.kind === 'TOOL_CALL_START' && e.toolName === 'write_file'
      );
      expect(hasWriteFileCall).toBe(true);
    },
    60000
  );

  test(
    'Scenario 2: Read-then-edit',
    async () => {
      const profile = createAnthropicProfile();
      const environment = createLocalExecutionEnvironment(tempDir);

      // Pre-create a file
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(tempDir, 'edit.txt'), 'old content');

      const session = createSession({ profile, environment, client, config });

      const events: Array<any> = [];
      const eventIterator = session.events();

      const collectPromise = (async () => {
        for await (const event of eventIterator) {
          events.push(event);
          if (event.kind === 'SESSION_END') {
            break;
          }
        }
      })();

      // Submit input
      await session.submit("Read edit.txt and change 'old' to 'new'");

      await collectPromise;

      // Verify file was edited
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(tempDir, 'edit.txt'), 'utf-8');
      expect(content).toContain('new');

      // Verify events include tool calls
      const hasToolCall = events.some((e) => e.kind === 'TOOL_CALL_START');
      expect(hasToolCall).toBe(true);
    },
    60000
  );

  test(
    'Scenario 3: Shell execution',
    async () => {
      const profile = createAnthropicProfile();
      const environment = createLocalExecutionEnvironment(tempDir);
      const session = createSession({ profile, environment, client, config });

      const events: Array<any> = [];
      const eventIterator = session.events();

      const collectPromise = (async () => {
        for await (const event of eventIterator) {
          events.push(event);
          if (event.kind === 'SESSION_END') {
            break;
          }
        }
      })();

      // Submit input
      await session.submit("Run 'echo hello' in the shell and show me the output");

      await collectPromise;

      // Verify events include shell tool call
      const hasShellCall = events.some(
        (e) => e.kind === 'TOOL_CALL_START' && e.toolName === 'shell'
      );
      expect(hasShellCall).toBe(true);

      // Verify output contains 'hello'
      const shellEnd = events.find(
        (e) => e.kind === 'TOOL_CALL_END' && e.toolName === 'shell'
      );
      expect(shellEnd?.output).toContain('hello');
    },
    60000
  );

  test(
    'Scenario 4: Truncation verification',
    async () => {
      const profile = createAnthropicProfile();
      const environment = createLocalExecutionEnvironment(tempDir);

      // Pre-create a large file (> 50k chars)
      const { writeFile } = await import('node:fs/promises');
      const largeContent = 'x'.repeat(60000);
      await writeFile(join(tempDir, 'large.txt'), largeContent);

      const session = createSession({ profile, environment, client, config });

      const events: Array<any> = [];
      const eventIterator = session.events();

      const collectPromise = (async () => {
        for await (const event of eventIterator) {
          events.push(event);
          if (event.kind === 'SESSION_END') {
            break;
          }
        }
      })();

      // Submit input
      await session.submit("Read the file large.txt");

      await collectPromise;

      // Verify TOOL_CALL_END event has full untruncated output
      const toolEnd = events.find(
        (e) => e.kind === 'TOOL_CALL_END' && e.toolName === 'read_file'
      );
      expect(toolEnd).toBeDefined();
      expect(toolEnd?.output.length).toBeGreaterThan(50000);
    },
    60000
  );

  test(
    'Scenario 5: Steering / follow-up',
    async () => {
      const profile = createAnthropicProfile();
      const environment = createLocalExecutionEnvironment(tempDir);
      const session = createSession({ profile, environment, client, config });

      const events: Array<any> = [];
      const eventIterator = session.events();

      const collectPromise = (async () => {
        for await (const event of eventIterator) {
          events.push(event);
          if (event.kind === 'SESSION_END') {
            break;
          }
        }
      })();

      // First submit
      await session.submit("Create a file called test.txt with 'initial'");

      // Wait for SESSION_IDLE (check history)
      const initialHistory = session.history();
      expect(initialHistory.length).toBeGreaterThan(0);

      // Second submit (follow-up)
      await session.submit("Now change 'initial' to 'updated' in test.txt");

      await collectPromise;

      // Verify file contains updated content
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(tempDir, 'test.txt'), 'utf-8');
      expect(content).toBe('updated');

      // Verify session history has two user turns
      const history = session.history();
      const userTurns = history.filter((t) => t.kind === 'user');
      expect(userTurns.length).toBe(2);
    },
    60000
  );
});
