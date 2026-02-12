export type TimeoutConfig = {
  readonly connectMs?: number;
  readonly requestMs?: number;
  readonly streamReadMs?: number;
};

export type RetryPolicy = {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableStatusCodes: ReadonlyArray<number>;
};

export type ResponseFormat = {
  readonly type: 'text' | 'json_object' | 'json_schema';
  readonly schema?: Record<string, unknown>;
  readonly name?: string;
};
