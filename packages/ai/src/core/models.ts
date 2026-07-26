export type ProviderInstanceId = string;
export type CredentialIdentityLifetime = 'cross-runtime' | 'process-local';
export type ReasoningLevel =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ToolChoice =
  'auto' | 'none' | 'required' | Readonly<{ type: 'tool'; name: string }>;
export type CacheRetention = 'none' | 'short' | 'long';

export interface ContextNormalizationPolicy {
  readonly unsupportedImage: 'reject' | 'placeholder';
  readonly crossProviderReasoning: 'preserve-readable' | 'as-text' | 'drop';
  readonly failedTurn: 'drop' | 'preserve-readable';
  readonly incompleteToolCall: 'drop' | 'as-text';
  readonly deferredTools: 'eager-fallback' | 'require-deferred';
  readonly tokenBudget: 'reject' | 'truncate-oldest-safe-turns';
}

export interface ModelRef<TProtocol extends string = string> {
  readonly providerInstanceId: ProviderInstanceId;
  readonly modelId: string;
  readonly protocol?: TProtocol;
}

export interface ModelCapabilities {
  readonly input: readonly ('text' | 'image')[];
  readonly streaming: boolean;
  readonly reasoning: boolean;
  readonly toolCalling: boolean;
  readonly parallelToolCalls: boolean;
  readonly deferredTools: boolean;
  readonly thinkingLevels: readonly ReasoningLevel[];
}

export interface ModelLimits {
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly maxInputImages?: number;
  readonly maxInputImageBytes?: number;
}

export interface CommonStreamRequestDefaults {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: readonly string[];
  readonly toolChoice?: ToolChoice;
  readonly reasoning?: ReasoningLevel;
  readonly cacheRetention?: CacheRetention;
  readonly timeoutMs?: number;
  readonly retry?: false | import('../transport/retry.js').RetryPolicy;
  readonly contextPolicy?: ContextNormalizationPolicy;
}

export interface TokenRates {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWriteByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
}

export interface ModelPricing {
  readonly currency: 'USD';
  readonly unit: 'per_million_tokens';
  readonly rates: Readonly<TokenRates>;
}

export interface ModelDefinition<TProtocol extends string = string> {
  readonly id: string;
  readonly upstreamModelId: string;
  readonly name: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly publisher?: string;
  readonly family?: string;
  readonly protocol: TProtocol;
  readonly protocolProfileId: string;
  readonly capabilities: Readonly<ModelCapabilities>;
  readonly limits: Readonly<ModelLimits>;
  readonly requestDefaults?: Readonly<CommonStreamRequestDefaults>;
  readonly pricing?: Readonly<ModelPricing>;
}

export interface ProviderSnapshot {
  readonly id: ProviderInstanceId;
  readonly kind: string;
  readonly name: string;
  readonly registrationGeneration: string;
  readonly configFingerprint: string;
  readonly authPolicyFingerprint: string;
}

export interface CatalogResolutionIdentity {
  readonly providerRegistrationGeneration: string;
  readonly providerConfigFingerprint: string;
}

export interface ModelHandle<TProtocol extends string = string> {
  readonly ref: ModelRef<TProtocol>;
  readonly definition: Readonly<ModelDefinition<TProtocol>>;
  readonly identity: Readonly<CatalogResolutionIdentity>;
}
