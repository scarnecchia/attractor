type ModelInfo = {
  readonly id: string;
  readonly provider: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly inputCostPer1kTokens: number;
  readonly outputCostPer1kTokens: number;
};

const MODEL_CATALOG: ReadonlyArray<ModelInfo> = [
  // OpenAI models
  {
    id: 'gpt-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.005,
    outputCostPer1kTokens: 0.015,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
  },
  {
    id: 'o1',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 32768,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsStructuredOutput: false,
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.06,
  },
  {
    id: 'o1-mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsStructuredOutput: false,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.012,
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsStructuredOutput: false,
    inputCostPer1kTokens: 0.0005,
    outputCostPer1kTokens: 0.0025,
  },

  // Anthropic models
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: false,
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
  },

  // Gemini models
  {
    id: 'gemini-2.0-flash',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 100000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.000075,
    outputCostPer1kTokens: 0.0003,
  },
  {
    id: 'gemini-2.0-pro',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 100000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    inputCostPer1kTokens: 0.0015,
    outputCostPer1kTokens: 0.006,
  },
];

export type { ModelInfo };
export { MODEL_CATALOG };
