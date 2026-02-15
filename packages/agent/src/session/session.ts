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
import { processInput } from './loop.js';
import type { SessionEventEmitter } from './events.js';
import type { SteeringQueue } from './steering.js';
import type { LoopDetector } from './loop-detection.js';

export type SessionOptions = {
  readonly profile: ProviderProfile;
  readonly environment: ExecutionEnvironment;
  readonly client: Client;
  readonly config: SessionConfig;
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
  readonly abortController: AbortController;
};

export function createSession(options: SessionOptions): Session {
  const sessionId = nanoid();
  let currentState: SessionState = 'IDLE';
  const history: Array<Turn> = [];
  const eventEmitter = createSessionEventEmitter();
  const steeringQueue = createSteeringQueue();
  const loopDetector = createLoopDetector(options.config.loopDetectionWindow);
  let abortController = new AbortController();

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
    abortController.abort();
    currentState = 'CLOSED';
    eventEmitter.emit({ kind: 'SESSION_END', sessionId });
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
