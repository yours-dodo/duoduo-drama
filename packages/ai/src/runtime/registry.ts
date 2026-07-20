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
import type { RetrySafety } from '../transport/dispatcher.js';
import type { TransportLimits } from '../transport/types.js';
import type { OAuthFlow } from '../auth/oauth.js';
import type { AmbientAuth } from '../auth/ambient.js';

export interface ProtocolEventSink {
  publish(event: ProtocolContentEvent): Promise<void>;
}

export interface ChatTransportBinding {
  readonly endpoint: string;
  readonly endpointForModel?: (model: Readonly<ModelDefinition>) => string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: Readonly<{
    readonly headerName: string;
    readonly defaultScheme?: string;
    readonly variants?: Readonly<
      Record<
        string,
        Readonly<{
          readonly headerName: string;
          readonly defaultScheme?: string;
        }>
      >
    >;
  }>;
  readonly limits?: Partial<TransportLimits>;
  readonly retrySafety?: RetrySafety;
  readonly redirect?: 'error' | 'same-origin';
}

export interface ChatProvider<TProtocol extends string = string> {
  readonly models: readonly ModelDefinition<TProtocol>[];
  readonly transport?: ChatTransportBinding;
  runChat(
    request: ChatRequest<TProtocol>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal>;
}

export interface ProviderContractSource {
  readonly kind: 'pi' | 'official' | 'fixture';
  readonly locator: string;
  readonly digest?: string;
}

export interface ProviderProtocolManifest {
  readonly capability: 'chat' | 'images' | 'videos';
  readonly protocol: string;
  readonly profileIds: readonly string[];
  readonly authSchemes: readonly string[];
  readonly endpointBranchIds: readonly string[];
  readonly requestFixtureIds: readonly string[];
  readonly streamFixtureIds: readonly string[];
  readonly errorFixtureIds: readonly string[];
  readonly sources: readonly ProviderContractSource[];
}

export interface ProviderContractManifest {
  readonly schemaVersion: 1;
  readonly providerKind: string;
  readonly bindings: readonly ProviderProtocolManifest[];
}

export interface ProviderAuth {
  readonly policyFingerprint?: string;
  readonly oauth?: OAuthFlow;
  readonly ambient?: AmbientAuth;
}

export interface Provider {
  readonly id: ProviderInstanceId;
  readonly kind: string;
  readonly name: string;
  readonly identity?: Readonly<Record<string, string>>;
  readonly auth?: ProviderAuth;
  readonly contractManifest?: ProviderContractManifest;
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
      authPolicyFingerprint: provider.auth?.policyFingerprint ?? 'none',
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
