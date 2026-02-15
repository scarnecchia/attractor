import type { RegisteredTool } from '../types/index.js';
import type { SubAgentMap, SubAgentResult } from './subagent.js';
import type { SubAgentMapInternal } from './subagent.js';
import { createSession } from '../session/session.js';
import type { SessionOptions, Session } from '../session/session.js';
import type { Client } from '@attractor/llm';
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
} from '../types/index.js';

export type SubAgentToolContext = {
  readonly subagents: SubAgentMap;
  readonly environment: ExecutionEnvironment;
  readonly profile: ProviderProfile;
  readonly client: Client;
  readonly config: SessionConfig;
  readonly currentDepth: number;
};

const DEFAULT_MAX_SUBAGENT_DEPTH = 1;

export function createSubAgentTools(
  context: SubAgentToolContext,
): ReadonlyArray<RegisteredTool> {
  return [
    createSpawnAgentTool(context),
    createSendInputTool(context),
    createWaitTool(context),
    createCloseAgentTool(context),
  ];
}

function createSpawnAgentTool(context: SubAgentToolContext): RegisteredTool {
  return {
    definition: {
      name: 'spawn_agent',
      description:
        'Spawn a child agent (subagent) with independent history that shares parent execution environment',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for the subagent',
          },
          instruction: {
            type: 'string',
            description: 'Initial input instruction for the child agent',
          },
          model: {
            type: 'string',
            description:
              'Optional model override (defaults to parent profile model)',
          },
          max_turns: {
            type: 'number',
            description:
              'Optional turn limit for the child agent (defaults to parent config)',
          },
        },
        required: ['id', 'instruction'],
      },
    },
    executor: async (args: Record<string, unknown>): Promise<string> => {
      const id = String(args['id']);
      const instruction = String(args['instruction']);
      const model = args['model'] ? String(args['model']) : undefined;
      const maxTurns = args['max_turns']
        ? Number(args['max_turns'])
        : undefined;

      if (context.currentDepth >= DEFAULT_MAX_SUBAGENT_DEPTH) {
        return JSON.stringify({
          error: 'Maximum subagent depth exceeded',
        });
      }

      const childProfile: ProviderProfile = model
        ? {
            ...context.profile,
            defaultModel: model,
          }
        : context.profile;

      const childConfig: SessionConfig = {
        ...context.config,
        ...(maxTurns !== undefined && { maxTurns }),
      };

      const childOptions: SessionOptions = {
        profile: childProfile,
        environment: context.environment,
        client: context.client,
        config: childConfig,
      };

      const childSession = createSession(childOptions);
      const handle = (context.subagents as SubAgentMapInternal).spawn(
        id,
        childSession,
      );

      await childSession.submit(instruction);

      return JSON.stringify({
        success: true,
        message: `Subagent ${id} spawned`,
      });
    },
  };
}

function createSendInputTool(context: SubAgentToolContext): RegisteredTool {
  return {
    definition: {
      name: 'send_input',
      description: 'Send input message to a running subagent',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Subagent identifier',
          },
          message: {
            type: 'string',
            description: 'Message to send to the subagent',
          },
        },
        required: ['id', 'message'],
      },
    },
    executor: async (args: Record<string, unknown>): Promise<string> => {
      const id = String(args['id']);
      const message = String(args['message']);

      const handle = context.subagents.get(id);
      if (!handle) {
        return JSON.stringify({
          error: `Subagent ${id} not found`,
        });
      }

      if (handle.status() !== 'running') {
        return JSON.stringify({
          error: `Subagent ${id} is not running`,
        });
      }

      await handle.session.submit(message);

      return JSON.stringify({
        success: true,
        message: `Message sent to subagent ${id}`,
      });
    },
  };
}

function createWaitTool(context: SubAgentToolContext): RegisteredTool {
  return {
    definition: {
      name: 'wait',
      description:
        'Wait for a subagent to complete and retrieve its results',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Subagent identifier',
          },
        },
        required: ['id'],
      },
    },
    executor: async (args: Record<string, unknown>): Promise<string> => {
      const id = String(args['id']);

      const handle = context.subagents.get(id);
      if (!handle) {
        return JSON.stringify({
          error: `Subagent ${id} not found`,
        });
      }

      const eventIterator = handle.session.events();

      let output = '';
      let success = true;

      for await (const event of eventIterator) {
        if (event.kind === 'SESSION_END') {
          break;
        }

        if (
          event.kind === 'LOOP_DETECTION' ||
          event.kind === 'TURN_LIMIT'
        ) {
          success = false;
        }

        if (event.kind === 'ERROR') {
          success = false;
        }

        if (event.kind === 'ASSISTANT_TEXT_DELTA') {
          output += event.text;
        }

        if (event.kind === 'ASSISTANT_TEXT_END') {
          // Mark end of assistant text block
        }
      }

      const turnsUsed = handle.session.history().filter((t) => t.kind === 'user')
        .length;

      const sessionState = handle.session.state();
      if (sessionState === 'CLOSED') {
        (context.subagents as SubAgentMapInternal)._setStatus(
          id,
          success ? 'completed' : 'error',
        );
      }

      const result: SubAgentResult = {
        output,
        success,
        turnsUsed,
      };

      (context.subagents as SubAgentMapInternal)._setResult(id, result);

      return JSON.stringify(result);
    },
  };
}

function createCloseAgentTool(context: SubAgentToolContext): RegisteredTool {
  return {
    definition: {
      name: 'close_agent',
      description: 'Close and abort a subagent',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Subagent identifier',
          },
        },
        required: ['id'],
      },
    },
    executor: async (args: Record<string, unknown>): Promise<string> => {
      const id = String(args['id']);

      const handle = context.subagents.get(id);
      if (!handle) {
        return JSON.stringify({
          error: `Subagent ${id} not found`,
        });
      }

      (context.subagents as SubAgentMapInternal).close(id);

      return JSON.stringify({
        success: true,
        message: `Subagent ${id} closed`,
      });
    },
  };
}
