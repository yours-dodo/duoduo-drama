# @duoduo/ai Package Guidelines

This package owns the provider-neutral AI runtime boundary used by the Agent service. Keep core domain types independent of providers, keep provider wire details behind runtime/testing seams, and never read credentials or environment variables implicitly during module import.

## Public Boundaries

- `@duoduo/ai` exposes provider-neutral runtime, auth, model, stream, and response types.
- `@duoduo/ai/images` owns provider-neutral image model, input/output, stream, cost, and direct-generation contracts; protocol-specific fields must remain typed through declaration merging.
- `@duoduo/ai/videos` owns provider-neutral video model, input/output, stream, cost, direct/resumable generation, and strict operation-claim contracts.
- `@duoduo/ai/protocols/xai-images` and `@duoduo/ai/protocols/xai-videos` own the official Grok Imagine image/video wire contracts. xAI video request IDs must be validated before route resolution, and generate/edit/extend routes must remain explicit rather than inferred.
- `@duoduo/ai/generation` owns the domain-neutral resumable-operation state machine, sealed-envelope/credential-verifier ports, progress, artifact, and compute-usage types; image/video packages own strict claims and branded refs.
- `@duoduo/ai/protocols/dashscope-images` and `@duoduo/ai/protocols/dashscope-image-tasks` own Qwen Wan direct and resumable image wire contracts; task IDs and operation routes must be validated before transport resolution.
- `@duoduo/ai/protocols/ark-images` and the `@duoduo/ai/providers/doubao` image binding own explicit Seedream Model ID/Endpoint ID direct generation; Ark image identities belong only in the request body and must never become route segments.
- `@duoduo/ai/protocols/openrouter-images` owns OpenRouter ordered multimodal request mapping and text/image response normalization; application consumers should use the Provider facade rather than importing the protocol adapter.
- `@duoduo/ai/providers/openrouter` owns the explicit OpenRouter chat and direct-image bindings, including public image model references and catalog descriptors.
- `@duoduo/ai/auth/node` exposes Node-only credential persistence, key-source, and local scope-authority factories. Keep these implementations out of provider-neutral modules.
- `@duoduo/ai/transport` exposes transport contracts and network policy helpers, but not test drivers.
- `@duoduo/ai/transport/node` exposes Node-only proxy fetch and WebSocket connectors.
- `@duoduo/ai/session` exposes provider-neutral session handles, leases, and lifecycle management.
- `@duoduo/ai/protocols/openai-responses` owns OpenAI Responses wire parsing and protocol types.
- `@duoduo/ai/protocols/azure-openai-responses` binds Azure OpenAI Responses to the shared Responses parser without copying it.
- `@duoduo/ai/protocols/anthropic-messages` owns Anthropic Messages request mapping, SSE parsing, replay signatures, thinking, tools, and cache usage.
- `@duoduo/ai/providers/openai` owns the explicit OpenAI provider factory and must not read environment variables or credentials implicitly.
- `@duoduo/ai/providers/azure-openai-responses` owns explicit Azure endpoint, deployment, API-version, and environment resolution.
- `@duoduo/ai/providers/anthropic` owns the explicit Anthropic provider factory and API-key/OAuth transport bindings.
- `@duoduo/ai/protocols/google-generative-ai` and `@duoduo/ai/providers/google` own the Gemini Developer API SSE path and explicit API-key binding.
- `@duoduo/ai/protocols/google-vertex` and `@duoduo/ai/providers/google-vertex` own the Vertex API-key/ADC branches, project/location identity, and shared Google wire semantics.
- `@duoduo/ai/protocols/bedrock-converse-stream` and `@duoduo/ai/providers/amazon-bedrock` own Bedrock Converse Stream mapping, event-stream parsing, regional endpoints, bearer auth, and AWS signing.
- `@duoduo/ai/protocols/openai-chat-completions` owns OpenAI Chat request mapping, streaming parsing, replay metadata, and typed compatibility profiles for thinking, tools, cache, routing, and session affinity.
- OpenAI-compatible Provider subpaths under `@duoduo/ai/providers/*` are thin explicit factories over the shared compatibility-profile boundary; add provider differences as descriptor/profile data rather than a provider-kind switch.
- `@duoduo/ai/auth/ambient/google-adc` and `@duoduo/ai/auth/ambient/aws` expose explicit injected ambient capabilities; they must not read SDK state, profiles, metadata services, or process environment implicitly.
- `@duoduo/ai/auth/oauth/anthropic` exposes the explicit Anthropic OAuth flow; provider-neutral OAuth ports remain exported from `@duoduo/ai`.
- `@duoduo/ai/protocols/openai-codex-responses`, `@duoduo/ai/protocols/mistral-conversations`, and `@duoduo/ai/protocols/pi-messages` own the remaining PI text protocol profiles, replay metadata, and stream normalization.
- `@duoduo/ai/protocols/dashscope` and `@duoduo/ai/providers/qwen` own curated DashScope native routes, regional/workspace endpoint resolution, and explicit Qwen protocol preference binding.
- `@duoduo/ai/protocols/ark-responses` and `@duoduo/ai/providers/doubao` own Ark v3 reasoning-event normalization, explicit Model ID/Endpoint ID body binding, and the Beijing Ark endpoint boundary.
- `@duoduo/ai/providers/openai-codex`, `@duoduo/ai/providers/mistral`, and `@duoduo/ai/providers/radius` expose explicit factories; Radius-discovered endpoints must remain bound to the configured gateway DNS boundary.
- `@duoduo/ai/auth/oauth/openai-codex`, `@duoduo/ai/auth/oauth/xai`, and `@duoduo/ai/auth/oauth/radius` expose explicit OAuth flows with abort-aware polling, refresh-token preservation, and optional remote revocation.
- `@duoduo/ai/testing` is the only public entrypoint for Faux and fixture transport helpers. Production exports must not include them.

Adapters receive only a request-scoped, already-bound `RequestTransport`; they must not choose or mutate the final URL or protected authentication headers. Provider-specific wire details stay outside provider-neutral core modules.

Stored authentication must flow through an explicit `CredentialStore` and `CredentialScopeAuthority`. Catalog identities are persistent only when both the credential store and scope fingerprint declare `cross-runtime` lifetime; process-local or ambient identities must never read or write a persistent `CatalogStore`.

Session identity must include the authorized scope identity independently from credential material. Credential replacement and logout fence matching sessions immediately, while resource disposal waits for active leases to drain. Requests without a `sessionId` use request-local resources and affinity only.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/ai test -- --run core stream testing`
- `pnpm --filter @duoduo/ai test -- --run transport openai-responses openai`
- `pnpm --filter @duoduo/ai test -- --run auth catalog runtime`
- `pnpm --filter @duoduo/ai test -- --run transport session azure-openai-responses`
- `pnpm --filter @duoduo/ai test -- --run anthropic-messages anthropic oauth`
- `pnpm --filter @duoduo/ai test -- --run google vertex bedrock ambient`
- `pnpm --filter @duoduo/ai test -- --run openai-chat-completions providers-compatible`
- `pnpm --filter @duoduo/ai test -- --run gateways github-copilot minimax kimi openrouter`
- `pnpm --filter @duoduo/ai test -- --run protocols providers baseline-parity oauth radius`
- `pnpm --filter @duoduo/ai test -- --run dashscope qwen`
- `pnpm --filter @duoduo/ai test -- --run ark-responses doubao`
- `pnpm --filter @duoduo/ai test -- --run images openrouter-images`
- `pnpm --filter @duoduo/ai test -- --run generation images videos xai-imagine`
- `pnpm --filter @duoduo/ai parity:check -- --pi-root vendor/pi`
- `pnpm --filter @duoduo/ai api:check`
- `pnpm --filter @duoduo/ai typecheck`
- `pnpm --filter @duoduo/ai build`
- `pnpm --filter @duoduo/ai manifest:check`

Tests are offline and deterministic.
Resumable generation references are runtime-owned and redacted. Only cross-runtime authentication identity, scope authority, and an injected `GenerationOperationCodec` may produce serialized operation tokens. Resume must fail closed on domain/version/TTL, scope, credential, Provider config, model, profile, or operation-binding mismatch; adapters never receive credential proofs or sealed tokens.
