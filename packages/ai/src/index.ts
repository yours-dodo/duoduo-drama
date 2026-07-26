export type {
  ActiveCredentialRecord,
  AuthBinding,
  CatalogAuthView,
  Clock,
  Credential,
  CredentialRecord,
  CredentialScopeKey,
  CredentialStore,
} from './auth/credential-store.js';
export { createCredentialRecordSealer } from './auth/record-sealer.js';
export type {
  CredentialCodec,
  CredentialRecordSealer,
  PersistedCredentialRecord,
} from './auth/record-sealer.js';
export type {
  AuthApi,
  AuthInteraction,
  AuthLogoutResult,
  AuthStatus,
} from './auth/login.js';
export type {
  CredentialScopeAction,
  CredentialScopeAuthority,
  CredentialScopeFingerprintVerification,
} from './auth/scope-authority.js';
export {
  canonicalizeCredentialScope,
  validateResolvedScope,
} from './auth/scope-authority.js';
export { createEnvironmentCredentialResolver } from './auth/ambient.js';
export type {
  AmbientAuth,
  AmbientAuthPolicy,
  AmbientAuthResolution,
  EnvironmentCredentialResolution,
  EnvironmentCredentialResolver,
  EnvironmentSource,
  SecretCredentialSource,
} from './auth/ambient.js';
export { canonicalizeCatalogCacheKey } from './catalog/cache-key.js';
export type { CatalogCacheKey } from './catalog/cache-key.js';
export type {
  CachedCatalog,
  CatalogCommitResult,
  CatalogRefreshTicket,
  CatalogStore,
  CatalogWriteValue,
} from './catalog/catalog-store.js';
export { digestCatalogPayload } from './catalog/manifest.js';

export { secret } from './auth/secret-value.js';
export type { SecretValue } from './auth/secret-value.js';
export type { RequestCredentialOverride } from './auth/api-key.js';
export type { CredentialOverridePolicy } from './auth/override-policy.js';
export type {
  AuthClock,
  AuthEvent,
  AuthFlowContext,
  AuthHttpRequest,
  AuthHttpResponse,
  AuthHttpTransport,
  AuthNetworkPolicy,
  AuthPrompt,
  AuthRuntimeOptions,
  OAuthCredential,
  OAuthCredentialResult,
  OAuthFlow,
  SecureRandom,
} from './auth/oauth.js';
export type {
  Provider,
  ProviderAuth,
  ProviderContractManifest,
  ProviderContractSource,
  ProviderProtocolManifest,
  ProvidersApi,
} from './runtime/registry.js';
export { createAi } from './runtime/create-ai.js';
export type {
  AiRuntime,
  CreateAiOptions,
  InventoryApi,
  ModelListFilter,
  ModelReadOptions,
  ModelsApi,
  RuntimeDisposeOptions,
  SessionsApi,
  RuntimeResourcePolicyInput,
  StreamOptionsInput,
} from './runtime/create-ai.js';
export type {
  SessionHandle,
  SessionLease,
  SessionResource,
} from './session/lease.js';
export type { RetryKind, RetryPolicy } from './transport/retry.js';

export { AiRuntimeError, isContextOverflowError } from './core/errors.js';
export type { AiError, AiErrorCategory } from './core/errors.js';
export type {
  AiContext,
  Message,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CompletedFinishReason,
  FinishReason,
  ResponseStatus,
} from './core/messages.js';
export type {
  ImageContent,
  JsonPrimitive,
  JsonValue,
  ReasoningContent,
  ReplayMetadata,
  TextContent,
  ToolCallContent,
} from './core/content.js';
export type {
  CacheRetention,
  CommonStreamRequestDefaults,
  ContextNormalizationPolicy,
  ModelCapabilities,
  ModelDefinition,
  ModelHandle,
  ModelLimits,
  ModelPricing,
  ModelRef,
  ProviderInstanceId,
  ReasoningLevel,
  ToolChoice,
} from './core/models.js';
export type {
  AiDiagnostic,
  AiResponseStream,
  AiStreamEvent,
  AssistantResponse,
  ProtocolContentEvent,
  ProtocolTerminal,
  ResolvedStreamOptions,
} from './core/events.js';
export type { Cost, Usage } from './core/usage.js';
export { calculateCost, estimateContextTokens } from './core/usage.js';
export {
  parseToolArguments,
  validateToolArguments,
  validateToolCall,
} from './core/tools.js';

export {
  toAssistantMessage,
  validateContext,
  toolNames,
} from './core/context.js';
export type {
  ContextValidationIssue,
  ContextValidationResult,
} from './core/context.js';
export {
  isCompletedFinishReason,
  isCancellableError,
  statusForFinishReason,
} from './core/finish-reason.js';
