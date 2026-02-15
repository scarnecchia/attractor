export type SessionState = 'IDLE' | 'PROCESSING' | 'AWAITING_INPUT' | 'CLOSED';

export type SessionConfig = {
  readonly model: string;
  readonly provider: string;
  readonly maxToolRoundsPerInput?: number;
  readonly maxTurns?: number;
  readonly contextWindowSize?: number;
  readonly toolOutputLimits?: Readonly<Record<string, number>>;
  readonly toolLineLimits?: Readonly<Record<string, number>>;
  readonly loopDetectionWindow?: number;
  readonly maxSubagentDepth?: number;
  readonly defaultCommandTimeout?: number;
  readonly userInstruction?: string;
  readonly workingDirectory?: string;
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
};
