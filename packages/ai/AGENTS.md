# @duoduo/ai Package Guidelines

This package owns the provider-neutral AI runtime boundary used by the Agent service. Keep core domain types independent of providers, keep provider wire details behind runtime/testing seams, and never read credentials or environment variables implicitly during module import.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/ai test -- --run core stream testing`
- `pnpm --filter @duoduo/ai api:check`
- `pnpm --filter @duoduo/ai typecheck`
- `pnpm --filter @duoduo/ai build`

Tests are offline and deterministic. Production exports must not include the Faux provider; it is available only from `@duoduo/ai/testing`.
