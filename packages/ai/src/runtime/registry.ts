import type {
  ChatRequest,
  ProtocolContentEvent,
  ProtocolTerminal,
} from '../core/events.js';
import type {
  ModelDefinition,
  ProviderInstanceId,
  ProviderSnapshot,
} from '../core/models.js';

export interface ProtocolEventSink {
  publish(event: ProtocolContentEvent): Promise<void>;
}

export interface ChatProvider<TProtocol extends string = string> {
  readonly models: readonly ModelDefinition<TProtocol>[];
  runChat(
    request: ChatRequest<TProtocol>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal>;
}

export interface Provider {
  readonly id: ProviderInstanceId;
  readonly kind: string;
  readonly name: string;
  readonly identity?: Readonly<Record<string, string>>;
  readonly chat?: ChatProvider;
}

export interface ProvidersApi {
  register(provider: Provider): void;
  registerAll(providers: Iterable<Provider>): void;
  unregister(providerInstanceId: ProviderInstanceId): boolean;
  list(): readonly ProviderSnapshot[];
}

export class ProviderRegistry implements ProvidersApi {
  private generation = 0;
  private readonly providers = new Map<
    string,
    { provider: Provider; snapshot: ProviderSnapshot }
  >();

  register(provider: Provider): void {
    if (this.providers.has(provider.id))
      throw new Error(`provider already registered: ${provider.id}`);
    const snapshot: ProviderSnapshot = Object.freeze({
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      registrationGeneration: `generation-${++this.generation}`,
      configFingerprint: JSON.stringify(provider.identity ?? {}),
      authPolicyFingerprint: 'none',
    });
    this.providers.set(provider.id, { provider, snapshot });
  }

  registerAll(providers: Iterable<Provider>): void {
    for (const provider of providers) this.register(provider);
  }

  unregister(providerInstanceId: string): boolean {
    return this.providers.delete(providerInstanceId);
  }

  list(): readonly ProviderSnapshot[] {
    return [...this.providers.values()].map(({ snapshot }) => snapshot);
  }

  get(
    providerId: string,
  ): { provider: Provider; snapshot: ProviderSnapshot } | undefined {
    return this.providers.get(providerId);
  }

  models(): readonly ModelDefinition[] {
    return [...this.providers.values()].flatMap(
      ({ provider }) => provider.chat?.models ?? [],
    );
  }
}
