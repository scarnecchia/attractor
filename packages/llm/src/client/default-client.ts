import { Client } from './client.js';
import type { ProviderAdapter } from '../types/index.js';

let defaultClient: Client | null = null;

export function getDefaultClient(
  adapterFactories?: Record<string, (config: Record<string, unknown>) => ProviderAdapter>
): Client {
  if (defaultClient === null) {
    defaultClient = Client.fromEnv(adapterFactories);
  }
  return defaultClient;
}

export function setDefaultClient(client: Client): void {
  defaultClient = client;
}

export function resetDefaultClient(): void {
  defaultClient = null;
}
