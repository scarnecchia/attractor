import type { SteeringTurn } from '../types/index.js';

export type SteeringQueue = {
  readonly steer: (message: string) => void;
  readonly followUp: (message: string) => void;
  readonly drainSteering: () => ReadonlyArray<SteeringTurn>;
  readonly drainFollowUp: () => ReadonlyArray<string>;
  readonly hasSteering: () => boolean;
  readonly hasFollowUp: () => boolean;
};

export function createSteeringQueue(): SteeringQueue {
  let steeringQueue: Array<string> = [];
  let followUpQueue: Array<string> = [];

  return {
    steer: (message: string) => {
      steeringQueue.push(message);
    },

    followUp: (message: string) => {
      followUpQueue.push(message);
    },

    drainSteering: (): ReadonlyArray<SteeringTurn> => {
      const turns = steeringQueue.map((content) => ({
        kind: 'steering' as const,
        content,
      }));
      steeringQueue = [];
      return turns;
    },

    drainFollowUp: (): ReadonlyArray<string> => {
      const messages = followUpQueue.slice();
      followUpQueue = [];
      return messages;
    },

    hasSteering: (): boolean => {
      return steeringQueue.length > 0;
    },

    hasFollowUp: (): boolean => {
      return followUpQueue.length > 0;
    },
  };
}
