# @duoduo/ai Package Guidelines

This package owns the provider-neutral AI runtime boundary used by the Agent service. Keep core domain types independent of providers, keep provider wire details behind runtime/testing seams, and never read credentials or environment variables implicitly during module import.

## Public Boundaries

- `@duoduo/ai` exposes provider-neutral runtime, auth, model, stream, and response types.
- `@duoduo/ai/transport` exposes transport contracts and network policy helpers, but not test drivers.
- `@duoduo/ai/protocols/openai-responses` owns OpenAI Responses wire parsing and protocol types.
- `@duoduo/ai/providers/openai` owns the explicit OpenAI provider factory and must not read environment variables or credentials implicitly.
- `@duoduo/ai/testing` is the only public entrypoint for Faux and fixture transport helpers. Production exports must not include them.

Adapters receive only a request-scoped, already-bound `RequestTransport`; they must not choose or mutate the final URL or protected authentication headers. Provider-specific wire details stay outside provider-neutral core modules.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/ai test -- --run core stream testing`
- `pnpm --filter @duoduo/ai test -- --run transport openai-responses openai`
- `pnpm --filter @duoduo/ai api:check`
- `pnpm --filter @duoduo/ai typecheck`
- `pnpm --filter @duoduo/ai build`
- `pnpm --filter @duoduo/ai manifest:check`

Tests are offline and deterministic.
