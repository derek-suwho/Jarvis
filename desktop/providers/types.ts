import type { ConnectionState, ContextBundle, ModelDescriptor, ModelRef, ProviderId } from '../../src/shared/contracts';
export type { ConnectionState, ContextBundle, ModelDescriptor, ModelRef, ProviderId } from '../../src/shared/contracts';

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: 'auth' | 'quota' | 'network' | 'unsupported' | 'unknown'; message: string };
export type ProviderRequest = { model: ModelRef; context: ContextBundle; reasoning?: string };
export interface SubscriptionAdapter {
  id: ProviderId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): Promise<ConnectionState>;
  listModels(): Promise<ModelDescriptor[]>;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
