import { nanoid } from 'nanoid';
import type { Client } from '@attractor/llm';
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
  SessionState,
  SessionEvent,
  Turn,
} from '../types/index.js';
import { createSessionEventEmitter } from './events.js';
import { createSteeringQueue } from './steering.js';
import { createLoopDetector } from './loop-detection.js';
import { createContextTracker } from './context-tracking.js';
import { processInput } from './loop.js';
import type { SessionEventEmitter } from './events.js';
import type { SteeringQueue } from './steering.js';
import type { LoopDetector } from './loop-detection.js';
import type { ContextTracker } from './context-tracking.js';
import { createSubAgentMap } from '../subagent/subagent.js';
import { createSubAgentTools, type SubAgentToolContext } from '../subagent/tools.js';

export type SessionOptions = {
  readonly profile: ProviderProfile;
  readonly environment: ExecutionEnvironment;
  readonly client: Client;
  readonly config: SessionConfig;
  readonly depth?: number;
};

export type Session = {
  readonly submit: (input: string) => Promise<void>;
  readonly steer: (message: string) => void;
  readonly followUp: (message: string) => void;
  readonly abort: () => Promise<void>;
  readonly events: () => AsyncIterable<SessionEvent>;
  readonly state: () => SessionState;
  readonly history: () => ReadonlyArray<Turn>;
};

export type LoopContext = {
  readonly sessionId: string;
  readonly profile: ProviderProfile;
  readonly environment: ExecutionEnvironment;
  readonly client: Client;
  readonly config: SessionConfig;
  readonly history: Array<Turn>;
  readonly eventEmitter: SessionEventEmitter;
  readonly steeringQueue: SteeringQueue;
  readonly loopDetector: LoopDetector;
  readonly contextTracker: ContextTracker;
  readonly abortController: AbortController;
};

export function createSession(options: SessionOptions): Session {
  const sessionId = nanoid();
  let currentState: SessionState = 'IDLE';
  const history: Array<Turn> = [];
  const eventEmitter = createSessionEventEmitter();
  const steeringQueue = createSteeringQueue();
  const loopDetector = createLoopDetector(options.config.loopDetectionWindow);
  const contextTracker = createContextTracker(options.config.contextWindowSize, 0.8);
  let abortController = new AbortController();
  const subagentMap = createSubAgentMap();
  let isAborting = false;

  // Register subagent tools on the profile after creation
  const subAgentContext: SubAgentToolContext = {
    subagents: subagentMap,
    environment: options.environment,
    profile: options.profile,
    client: options.client,
    config: options.config,
    currentDepth: options.depth ?? 0,
  };

  for (const tool of createSubAgentTools(subAgentContext)) {
    options.profile.toolRegistry.register(tool);
  }

  // Emit session start immediately
  eventEmitter.emit({ kind: 'SESSION_START', sessionId });

  const submit = async (input: string): Promise<void> => {
    if (currentState === 'CLOSED') {
      throw new Error('Session is closed');
    }

    // Append user input to history
    history.push({
      kind: 'user',
      content: input,
    });

    // Track context usage for user input
    contextTracker.record(input.length);

    currentState = 'PROCESSING';

    try {
      const context: LoopContext = {
        sessionId,
        profile: options.profile,
        environment: options.environment,
        client: options.client,
        config: options.config,
        history,
        eventEmitter,
        steeringQueue,
        loopDetector,
        contextTracker,
        abortController,
      };

      await processInput(context);

      currentState = 'IDLE';

      // Process any queued follow-ups
      const followUps = steeringQueue.drainFollowUp();
      for (const message of followUps) {
        // Recursively submit follow-ups
        await submit(message);
      }
    } catch (err) {
      currentState = 'CLOSED';
      const error = err instanceof Error ? err : new Error(String(err));
      eventEmitter.error(error);
    }
  };

  const steer = (message: string): void => {
    steeringQueue.steer(message);
  };

  const followUp = (message: string): void => {
    steeringQueue.followUp(message);
  };

  const abort = async (): Promise<void> => {
    // Make abort idempotent: if already aborting, return immediately
    if (isAborting) {
      return;
    }
    isAborting = true;

    // 1. Cancel active LLM stream via AbortController.abort()
    abortController.abort();

    // 2. Kill running processes:
    //    LocalExecutionEnvironment's execCommand already handles SIGTERM → 2s → SIGKILL
    //    via the abort signal passed to child processes

    // 3. Close all subagents via subAgentMap.closeAll()
    subagentMap.closeAll();

    // 4. Transition state to CLOSED
    currentState = 'CLOSED';

    // 5. Emit SESSION_END event
    eventEmitter.emit({ kind: 'SESSION_END', sessionId });

    // 6. Complete the event emitter (emitter.complete())
    eventEmitter.complete();
  };

  const events = (): AsyncIterable<SessionEvent> => {
    return eventEmitter.iterator();
  };

  const state = (): SessionState => {
    return currentState;
  };

  const getHistory = (): ReadonlyArray<Turn> => {
    return history;
  };

  return {
    submit,
    steer,
    followUp,
    abort,
    events,
    state,
    history: getHistory,
  };
}
