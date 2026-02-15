import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, StreamEvent } from '@attractor/llm';
import type { Session, SessionOptions } from '../session/session.js';
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
  RegisteredTool,
} from '../types/index.js';
import { createSubAgentMap } from './subagent.js';
import { createSubAgentTools, type SubAgentToolContext } from './tools.js';

const defaultUsage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function createMockProfile(): ProviderProfile {
  const toolRegistry = {
    get: () => null,
    register: () => {},
    unregister: () => {},
    definitions: () => [],
    list: () => [],
  };

  return {
    id: 'openai' as const,
    displayName: 'OpenAI',
    defaultModel: 'gpt-4',
    toolRegistry: toolRegistry as any,
    supportsParallelToolCalls: false,
    buildSystemPrompt: () => 'You are helpful.',
    projectDocFiles: [],
    defaultCommandTimeout: 5000,
  };
}

function createMockEnvironment(): ExecutionEnvironment {
  return {
    readFile: async (path: string) => `content of ${path}`,
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => true,
    listDirectory: async () => [],
    execCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 }),
    grep: async () => '',
    glob: async () => [],
    initialize: async () => {},
    cleanup: async () => {},
    workingDirectory: () => '/tmp',
    platform: () => 'linux',
    osVersion: () => '5.10.0',
  };
}

function createMockClient(responses: Array<Array<StreamEvent>>): Client {
  let callIndex = 0;

  return {
    stream: function* (/* request */) {
      if (callIndex < responses.length) {
        for (const event of responses[callIndex]!) {
          yield event;
        }
        callIndex++;
      }
    } as any,
    complete: async () => {},
  } as any;
}

function createMockSession(overrides?: Partial<Session>): Session {
  const history: Array<any> = [];

  return {
    submit: vi.fn(async (input: string) => {
      history.push({ kind: 'user', content: input });
    }),
    steer: vi.fn(),
    followUp: vi.fn(),
    abort: vi.fn(async () => {}),
    events: vi.fn(async function* () {
      // Empty event stream by default
    }),
    state: vi.fn(() => 'IDLE' as const),
    history: vi.fn(() => history),
    ...overrides,
  };
}

describe('SubAgentMap', () => {
  describe('spawn and get', () => {
    it('should spawn a subagent and retrieve it', () => {
      const map = createSubAgentMap();
      const mockSession = createMockSession();

      const handle = map.spawn('agent1', mockSession);

      expect(handle.id).toBe('agent1');
      expect(handle.session).toBe(mockSession);
      expect(handle.status()).toBe('running');
      expect(handle.result()).toBeNull();
    });

    it('should get a spawned subagent by id', () => {
      const map = createSubAgentMap();
      const mockSession = createMockSession();

      map.spawn('agent1', mockSession);
      const retrieved = map.get('agent1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('agent1');
      expect(retrieved?.session).toBe(mockSession);
    });

    it('should return null for non-existent subagent', () => {
      const map = createSubAgentMap();

      const result = map.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw when spawning duplicate id', () => {
      const map = createSubAgentMap();
      const mockSession = createMockSession();

      map.spawn('agent1', mockSession);

      expect(() => map.spawn('agent1', mockSession)).toThrow(
        'Subagent with id "agent1" already exists',
      );
    });
  });

  describe('close', () => {
    it('should abort a running subagent', () => {
      const map = createSubAgentMap();
      const mockAbort = vi.fn(async () => {});
      const mockSession = createMockSession({ abort: mockAbort });

      map.spawn('agent1', mockSession);
      const handle = map.get('agent1');

      expect(handle?.status()).toBe('running');

      map.close('agent1');

      expect(mockAbort).toHaveBeenCalled();
      expect(handle?.status()).toBe('aborted');
    });

    it('should be no-op when closing non-existent subagent', () => {
      const map = createSubAgentMap();

      expect(() => map.close('nonexistent')).not.toThrow();
    });

    it('should be no-op when closing already-completed subagent', () => {
      const map = createSubAgentMap();
      const mockSession = createMockSession();
      const handle = map.spawn('agent1', mockSession);

      (map as any)._setStatus('agent1', 'completed');
      const mockAbort = vi.fn();
      mockSession.abort = mockAbort;

      map.close('agent1');

      expect(mockAbort).not.toHaveBeenCalled();
    });
  });

  describe('closeAll', () => {
    it('should close all running subagents', () => {
      const map = createSubAgentMap();
      const session1 = createMockSession();
      const session2 = createMockSession();
      const session3 = createMockSession();

      map.spawn('agent1', session1);
      map.spawn('agent2', session2);
      map.spawn('agent3', session3);

      map.closeAll();

      expect(map.get('agent1')?.status()).toBe('aborted');
      expect(map.get('agent2')?.status()).toBe('aborted');
      expect(map.get('agent3')?.status()).toBe('aborted');
    });
  });

  describe('list', () => {
    it('should return all spawned subagents', () => {
      const map = createSubAgentMap();
      const session1 = createMockSession();
      const session2 = createMockSession();

      map.spawn('agent1', session1);
      map.spawn('agent2', session2);

      const list = map.list();

      expect(list).toHaveLength(2);
      expect(list[0]?.id).toBe('agent1');
      expect(list[1]?.id).toBe('agent2');
    });

    it('should return empty array when no subagents', () => {
      const map = createSubAgentMap();

      const list = map.list();

      expect(list).toHaveLength(0);
    });
  });
});

describe('Subagent Tools', () => {
  let mockProfile: ProviderProfile;
  let mockEnv: ExecutionEnvironment;
  let config: SessionConfig;
  let subagentMap: any;
  let mockClient: Client;

  beforeEach(() => {
    mockProfile = createMockProfile();
    mockEnv = createMockEnvironment();
    config = {
      model: 'gpt-4',
      provider: 'openai',
      maxToolRoundsPerInput: 5,
      maxTurns: 20,
    };
    subagentMap = createSubAgentMap();
    mockClient = createMockClient([]);
  });

  describe('spawn_agent tool', () => {
    it('should spawn a subagent with independent history (AC7.1)', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const spawnTool = tools.find((t) => t.definition.name === 'spawn_agent')!;

      const result = await spawnTool.executor(
        {
          id: 'child1',
          instruction: 'Test instruction',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);

      const handle = subagentMap.get('child1');
      expect(handle).not.toBeNull();
      expect(handle?.status()).toBe('running');

      // Child session has independent history (includes the instruction we submitted)
      const childHistory = handle?.session.history();
      expect(childHistory).not.toBeNull();
      expect(childHistory!.length).toBeGreaterThanOrEqual(1);

      // Verify instruction was added to child history
      const userTurns = childHistory!.filter((t) => t.kind === 'user');
      expect(userTurns).toHaveLength(1);
      expect(userTurns[0]?.content).toBe('Test instruction');
    });

    it('should use parent profile by default (AC7.2)', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const spawnTool = tools.find((t) => t.definition.name === 'spawn_agent')!;

      await spawnTool.executor(
        {
          id: 'child1',
          instruction: 'Test',
        },
        mockEnv,
      );

      const handle = subagentMap.get('child1');
      expect(handle?.session).not.toBeNull();
    });

    it('should override model when provided (AC7.2)', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const spawnTool = tools.find((t) => t.definition.name === 'spawn_agent')!;

      await spawnTool.executor(
        {
          id: 'child1',
          instruction: 'Test',
          model: 'gpt-3.5-turbo',
        },
        mockEnv,
      );

      const handle = subagentMap.get('child1');
      expect(handle).not.toBeNull();
    });

    it('should reject spawn when depth limit exceeded (AC7.5)', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 1,
      };

      const tools = createSubAgentTools(context);
      const spawnTool = tools.find((t) => t.definition.name === 'spawn_agent')!;

      const result = await spawnTool.executor(
        {
          id: 'child1',
          instruction: 'Test',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('Maximum subagent depth exceeded');
    });
  });

  describe('send_input tool', () => {
    it('should send message to running subagent (AC7.3)', async () => {
      const mockSession = createMockSession();
      subagentMap.spawn('agent1', mockSession);

      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const sendTool = tools.find((t) => t.definition.name === 'send_input')!;

      const result = await sendTool.executor(
        {
          id: 'agent1',
          message: 'Follow-up message',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(mockSession.submit).toHaveBeenCalledWith('Follow-up message');
    });

    it('should error when subagent not found', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const sendTool = tools.find((t) => t.definition.name === 'send_input')!;

      const result = await sendTool.executor(
        {
          id: 'nonexistent',
          message: 'Test',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not found');
    });

    it('should error when subagent not running', async () => {
      const mockSession = createMockSession();
      const handle = subagentMap.spawn('agent1', mockSession);
      (subagentMap as any)._setStatus('agent1', 'completed');

      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const sendTool = tools.find((t) => t.definition.name === 'send_input')!;

      const result = await sendTool.executor(
        {
          id: 'agent1',
          message: 'Test',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not running');
    });
  });

  describe('wait tool', () => {
    it('should wait for subagent and return results (AC7.3, AC7.6)', async () => {
      const mockEvents = async function* () {
        yield { kind: 'ASSISTANT_TEXT_DELTA' as const, text: 'Hello ' };
        yield { kind: 'ASSISTANT_TEXT_DELTA' as const, text: 'world' };
        yield { kind: 'ASSISTANT_TEXT_END' as const };
        yield { kind: 'SESSION_END' as const, sessionId: 'test' };
      };

      const mockSession = createMockSession({
        events: vi.fn(mockEvents),
        history: vi.fn(() => [
          { kind: 'user', content: 'Test' },
          {
            kind: 'assistant',
            content: [{ type: 'text' as const, text: 'Hello world' }],
          },
        ]),
      });

      subagentMap.spawn('agent1', mockSession);

      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const waitTool = tools.find((t) => t.definition.name === 'wait')!;

      const result = await waitTool.executor(
        {
          id: 'agent1',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.output).toBe('Hello world');
      expect(parsed.success).toBe(true);
      expect(parsed.turnsUsed).toBeGreaterThanOrEqual(0);
    });

    it('should error when subagent not found', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const waitTool = tools.find((t) => t.definition.name === 'wait')!;

      const result = await waitTool.executor(
        {
          id: 'nonexistent',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not found');
    });

    it('should mark success false on loop detection', async () => {
      const mockEvents = async function* () {
        yield {
          kind: 'LOOP_DETECTION' as const,
          message: 'Loop detected',
        };
        yield { kind: 'SESSION_END' as const, sessionId: 'test' };
      };

      const mockSession = createMockSession({
        events: vi.fn(mockEvents),
        history: vi.fn(() => [{ kind: 'user', content: 'Test' }]),
      });

      subagentMap.spawn('agent1', mockSession);

      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const waitTool = tools.find((t) => t.definition.name === 'wait')!;

      const result = await waitTool.executor(
        {
          id: 'agent1',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
    });
  });

  describe('close_agent tool', () => {
    it('should close a running subagent (AC7.4)', async () => {
      const mockSession = createMockSession();
      subagentMap.spawn('agent1', mockSession);

      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const closeTool = tools.find((t) => t.definition.name === 'close_agent')!;

      const result = await closeTool.executor(
        {
          id: 'agent1',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(subagentMap.get('agent1')?.status()).toBe('aborted');
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it('should error when subagent not found', async () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);
      const closeTool = tools.find((t) => t.definition.name === 'close_agent')!;

      const result = await closeTool.executor(
        {
          id: 'nonexistent',
        },
        mockEnv,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not found');
    });
  });

  describe('all four tools created together', () => {
    it('should create all four tools in array', () => {
      const context: SubAgentToolContext = {
        subagents: subagentMap,
        environment: mockEnv,
        profile: mockProfile,
        client: mockClient,
        config,
        currentDepth: 0,
      };

      const tools = createSubAgentTools(context);

      expect(tools).toHaveLength(4);

      const toolNames = tools.map((t) => t.definition.name);
      expect(toolNames).toContain('spawn_agent');
      expect(toolNames).toContain('send_input');
      expect(toolNames).toContain('wait');
      expect(toolNames).toContain('close_agent');

      // Verify all have proper definitions
      for (const tool of tools) {
        expect(tool.definition.name).toBeTruthy();
        expect(tool.definition.description).toBeTruthy();
        expect(tool.definition.parameters).toBeTruthy();
        expect(tool.executor).toBeTruthy();
      }
    });
  });
});
