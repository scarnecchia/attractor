import { MODEL_CATALOG, type ModelInfo } from './models.js';

function getModelInfo(modelId: string): ModelInfo | null {
  const model = MODEL_CATALOG.find((m) => m.id === modelId);
  return model ?? null;
}

function listModels(provider?: string): ReadonlyArray<ModelInfo> {
  if (provider === undefined) {
    return MODEL_CATALOG;
  }
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

function getLatestModel(
  provider: string,
  tier?: 'flagship' | 'fast' | 'mini'
): ModelInfo | null {
  const models = listModels(provider);

  if (models.length === 0) {
    return null;
  }

  if (tier === 'flagship') {
    // Flagship: most capable models
    const flagshipModels = models.filter((m) => {
      const id = m.id.toLowerCase();
      // o1, o3, gpt-4o, claude-opus are flagship
      return (
        id.includes('o1') ||
        id.includes('o3') ||
        id.includes('gpt-4o') ||
        id.includes('opus') ||
        id.includes('2.0-pro')
      );
    });
    return flagshipModels[0] ?? null;
  }

  if (tier === 'mini') {
    // Mini: smallest/fastest models
    const miniModels = models.filter((m) => {
      const id = m.id.toLowerCase();
      return (
        id.includes('mini') ||
        id.includes('haiku') ||
        id.includes('fast') ||
        id.includes('2.0-flash')
      );
    });
    return miniModels[0] ?? null;
  }

  if (tier === 'fast') {
    // Fast: balanced models
    const fastModels = models.filter((m) => {
      const id = m.id.toLowerCase();
      return (
        id.includes('sonnet') ||
        id.includes('gpt-4o') ||
        id.includes('2.0-flash')
      );
    });
    return fastModels[0] ?? null;
  }

  // Default: return first/latest model
  return models[0] ?? null;
}

export { getModelInfo, listModels, getLatestModel };
