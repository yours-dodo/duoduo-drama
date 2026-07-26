import {
  cloudflareAiGatewayModelRef,
  cloudflareAiGatewayProvider,
} from '@duoduo/ai/providers/cloudflare-ai-gateway';
import {
  fireworksModelRef,
  fireworksProvider,
} from '@duoduo/ai/providers/fireworks';
import {
  kimiCodingModelRef,
  kimiCodingProvider,
} from '@duoduo/ai/providers/kimi-coding';
import { minimaxModelRef, minimaxProvider } from '@duoduo/ai/providers/minimax';
import {
  minimaxCnModelRef,
  minimaxCnProvider,
} from '@duoduo/ai/providers/minimax-cn';
import {
  openCodeModelRef,
  openCodeProvider,
} from '@duoduo/ai/providers/opencode';
import {
  openCodeGoModelRef,
  openCodeGoProvider,
} from '@duoduo/ai/providers/opencode-go';
import {
  openRouterModelRef,
  openRouterProvider,
} from '@duoduo/ai/providers/openrouter';
import {
  vercelAiGatewayModelRef,
  vercelAiGatewayProvider,
} from '@duoduo/ai/providers/vercel-ai-gateway';

void cloudflareAiGatewayModelRef();
void fireworksModelRef();
void kimiCodingModelRef();
void minimaxModelRef();
void minimaxCnModelRef();
void openCodeModelRef();
void openCodeGoModelRef();
void openRouterModelRef();
void vercelAiGatewayModelRef();
void [
  cloudflareAiGatewayProvider({ accountId: 'account', gatewayId: 'gateway' }),
  fireworksProvider(),
  kimiCodingProvider(),
  minimaxProvider(),
  minimaxCnProvider(),
  openCodeProvider(),
  openCodeGoProvider(),
  openRouterProvider({
    openRouterRouting: { only: ['anthropic'], allow_fallbacks: false },
  }),
  vercelAiGatewayProvider({
    vercelGatewayRouting: { only: ['anthropic'], order: ['anthropic'] },
  }),
];
