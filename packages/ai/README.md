# `@duoduo/ai`

`@duoduo/ai` is the provider-neutral AI runtime used by Duoduo Drama. It exposes explicit chat, image, video, authentication, catalog, session, transport, resumable-operation, CLI, and testing boundaries without importing provider SDKs or reading credentials during module import.

## Quick start

Import only the Provider subpaths the application actually needs:

```ts
import { createAi } from '@duoduo/ai';
import { createOpenAiProvider } from '@duoduo/ai/providers/openai';

const ai = createAi();
ai.providers.register(createOpenAiProvider());
```

To opt into the full built-in inventory, import the dedicated all-provider entry. It is asynchronous because a self-hosted generation Provider discovers its injected gateway catalog during construction.

```ts
import { createAi } from '@duoduo/ai';
import { builtinProviders } from '@duoduo/ai/providers/all';

const ai = createAi();
const result = await builtinProviders({
  qwen: { region: 'us' },
});
ai.providers.registerAll(result.providers);
console.log(result.unconfigured);
```

The root `@duoduo/ai` entry never discovers or registers Providers. `@duoduo/ai/providers/all` is the only entry that statically imports all built-ins.

## Built-in Provider inventory

The generated catalog and package export map must contain the same 40 Provider kinds. Blank configuration means that the Provider has safe package defaults; credentials are still supplied through an explicit credential store, ambient capability, OAuth flow, or request override.

| Provider kind            | Required non-secret configuration before `builtinProviders()` registers it |
| ------------------------ | -------------------------------------------------------------------------- |
| `amazon-bedrock`         | None                                                                       |
| `ant-ling`               | None                                                                       |
| `anthropic`              | None                                                                       |
| `azure-openai-responses` | `baseUrl                                                                   | resourceName`, `deploymentName | deploymentMap` |
| `cerebras`               | None                                                                       |
| `cloudflare-ai-gateway`  | `accountId`, `gatewayId`                                                   |
| `cloudflare-workers-ai`  | `accountId`                                                                |
| `deepseek`               | None                                                                       |
| `doubao`                 | None                                                                       |
| `fireworks`              | None                                                                       |
| `github-copilot`         | None                                                                       |
| `google`                 | None                                                                       |
| `google-vertex`          | None                                                                       |
| `groq`                   | None                                                                       |
| `huggingface`            | None                                                                       |
| `kimi-coding`            | None                                                                       |
| `kling`                  | None                                                                       |
| `minimax`                | None                                                                       |
| `minimax-cn`             | None                                                                       |
| `mistral`                | None                                                                       |
| `moonshotai`             | None                                                                       |
| `moonshotai-cn`          | None                                                                       |
| `nvidia`                 | None                                                                       |
| `openai`                 | None                                                                       |
| `openai-codex`           | None                                                                       |
| `opencode`               | None                                                                       |
| `opencode-go`            | None                                                                       |
| `openrouter`             | None                                                                       |
| `qwen`                   | `region`                                                                   |
| `radius`                 | None                                                                       |
| `self-hosted-generation` | `gateway`, `gatewayBaseUrl`                                                |
| `together`               | None                                                                       |
| `vercel-ai-gateway`      | None                                                                       |
| `xai`                    | None                                                                       |
| `xiaomi`                 | None                                                                       |
| `xiaomi-token-plan-ams`  | None                                                                       |
| `xiaomi-token-plan-cn`   | None                                                                       |
| `xiaomi-token-plan-sgp`  | None                                                                       |
| `zai`                    | None                                                                       |
| `zai-coding-cn`          | None                                                                       |

`self-hosted-generation` always requires an injected `DuoduoGenerationGateway`. A `gatewayBaseUrl` only supplies the public task-binding identity and cannot be used by the CLI to invent a gateway adapter. Missing non-secret options appear in `result.unconfigured`; the runtime never guesses regions, accounts, deployments, or gateway implementations.

## Authentication and local CLI

The Node CLI is available after build as `duoduo-ai` and through the public `@duoduo/ai/cli` API.

```bash
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai exec duoduo-ai providers
pnpm --filter @duoduo/ai exec duoduo-ai models openai --available
pnpm --filter @duoduo/ai exec duoduo-ai auth status openai --json
```

Supported commands are `providers`, `models`, `models refresh`, `auth status`, `auth login`, `auth logout`, and `diagnose`. Inventory commands distinguish statically known models from models available in the configured runtime. Machine-readable output uses `--json` and passes through a second redaction layer.

Credential persistence is fail-closed. Set `DUODUO_AI_MASTER_KEY` to a base64url-encoded 32-byte key to enable the encrypted file store. Without a usable key, credential-mutating commands return `CREDENTIAL_CODEC_KEY_UNAVAILABLE` with exit code 69. `DUODUO_AI_HOME` overrides the local state directory. `config.json` may contain only non-secret Provider options; secret-shaped fields are rejected rather than persisted.

## Images, videos, and resumable generation

Use `@duoduo/ai/images` and `@duoduo/ai/videos` for channel-specific model handles and generation calls. Resumable Providers return strict, runtime-owned operation references that can be detached, serialized through an injected operation codec, parsed, resumed, and cancelled. Operation tokens and credential proofs are never projected into public catalog metadata or CLI logs.

Self-hosted image/video generation uses:

- `@duoduo/ai/protocols/duoduo-generation-v1` for the owned catalog/task contract;
- `@duoduo/ai/providers/self-hosted-generation` for the Provider binding;
- an application-injected `DuoduoGenerationGateway` implementation for real infrastructure.

The public seam does not expose cloud GPU drivers, schedulers, cloud SDKs, or a business artifact store.

## Aggregators and extensions

Third-party aggregators compose chat, image, and video capabilities behind one Provider instance. Trusted code owns endpoints, authentication, protocol selection, operation mode, compatibility profiles, and fallback targets. Remote catalog shards may add safe model facts only; endpoint, auth, protocol, route, operation, profile, URL, token, or secret fields are rejected.

When adding a Provider:

1. Create `src/providers/<kind>/index.ts` with an explicit factory and no environment reads at import time.
2. Add `./providers/<kind>` to `package.json`.
3. Add its factory to `src/providers/all/index.ts`; declare required non-secret options rather than guessing defaults.
4. Run `pnpm --filter @duoduo/ai catalog:update`, tests, API check, and manifest check.

When adding a protocol:

1. Keep wire types, validation, mapping, and streaming normalization in `src/protocols/<protocol>/`.
2. Extend protocol option/compatibility maps through declaration merging.
3. Bind it from a Provider; adapters receive a request-scoped transport and must not choose final URLs or protected auth headers.
4. Add offline fixtures for normal, edge, failure, abort, replay, and redaction behavior.

## Catalog generation

```bash
pnpm --filter @duoduo/ai catalog:update
pnpm --filter @duoduo/ai catalog:update -- --check --offline
pnpm --filter @duoduo/ai manifest:check
```

The semantic catalog digest excludes timestamps and is stable across input order. Reviewed remote shards may contain only `id`, `name`, `capabilities`, `limits`, `pricing`, `region`, and `deprecated` model fields. The manifest checker fences the 40 Provider exports, generated catalog, public entrypoints, build targets, CLI binary, and implementation status.

## Live harness safety

Normal tests, builds, installation, and catalog generation never import the live runner. The only entry is explicit:

```bash
DUODUO_AI_LIVE=1 \
DUODUO_AI_LIVE_PROVIDERS=openai \
DUODUO_AI_LIVE_MAX_USD=0.25 \
pnpm --filter @duoduo/ai test:live -- \
  --provider openai \
  --model "$OPENAI_MODEL" \
  --estimated-max-usd 0.05 \
  --allow-paid
```

The runner requires all four independent opt-ins: `DUODUO_AI_LIVE=1`, an allowlisted Provider, a positive USD budget, and `--allow-paid`. It never guesses a Provider or model. Image runs additionally require `DUODUO_AI_LIVE_MAX_IMAGES` and `--images`; video runs require `DUODUO_AI_LIVE_MAX_VIDEO_SECONDS` and `--video-seconds`. Unknown or over-budget cost is skipped with a dedicated non-success code.

This repository intentionally ships no default network executor. Passing every safety gate still returns `LIVE_EXECUTOR_NOT_CONFIGURED` until an application injects an audited Provider-specific executor with bounded origins, deadlines, concurrency, synthetic inputs, and redacted output. OAuth live flows remain outside the automatic suite and require a dedicated test account and interactive command.

## Verification

```bash
pnpm --filter @duoduo/ai format:check
pnpm --filter @duoduo/ai lint
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai test
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai api:check
pnpm --filter @duoduo/ai manifest:check
```

All default tests are offline and deterministic.
