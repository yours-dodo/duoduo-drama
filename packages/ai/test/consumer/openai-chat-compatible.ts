import {
  createOpenAiChatCompletionsAdapter,
  openAiChatCompletionsContract,
  openAiChatCompletionsReplayCodecs,
  type OpenAiChatCompatibility,
} from '@duoduo/ai/protocols/openai-chat-completions';
import {
  antLingModelRef,
  antLingProvider,
} from '@duoduo/ai/providers/ant-ling';
import { cerebrasProvider } from '@duoduo/ai/providers/cerebras';
import { cloudflareWorkersAiProvider } from '@duoduo/ai/providers/cloudflare-workers-ai';
import { deepseekProvider } from '@duoduo/ai/providers/deepseek';
import { groqProvider } from '@duoduo/ai/providers/groq';
import { huggingfaceProvider } from '@duoduo/ai/providers/huggingface';
import { moonshotAiProvider } from '@duoduo/ai/providers/moonshotai';
import { moonshotAiCnProvider } from '@duoduo/ai/providers/moonshotai-cn';
import { nvidiaProvider } from '@duoduo/ai/providers/nvidia';
import { togetherProvider } from '@duoduo/ai/providers/together';
import { xAiProvider } from '@duoduo/ai/providers/xai';
import { xiaomiProvider } from '@duoduo/ai/providers/xiaomi';
import { xiaomiTokenPlanAmsProvider } from '@duoduo/ai/providers/xiaomi-token-plan-ams';
import { xiaomiTokenPlanCnProvider } from '@duoduo/ai/providers/xiaomi-token-plan-cn';
import { xiaomiTokenPlanSgpProvider } from '@duoduo/ai/providers/xiaomi-token-plan-sgp';
import { zaiProvider } from '@duoduo/ai/providers/zai';
import { zaiCodingCnProvider } from '@duoduo/ai/providers/zai-coding-cn';

const compatibility: OpenAiChatCompatibility = { thinkingFormat: 'deepseek' };
void createOpenAiChatCompletionsAdapter({ compatibility });
void openAiChatCompletionsContract;
void openAiChatCompletionsReplayCodecs;
void antLingModelRef();
void [
  antLingProvider(),
  cerebrasProvider(),
  cloudflareWorkersAiProvider({ accountId: 'account' }),
  deepseekProvider(),
  groqProvider(),
  huggingfaceProvider(),
  moonshotAiProvider(),
  moonshotAiCnProvider(),
  nvidiaProvider(),
  togetherProvider(),
  xAiProvider(),
  xiaomiProvider(),
  xiaomiTokenPlanAmsProvider(),
  xiaomiTokenPlanCnProvider(),
  xiaomiTokenPlanSgpProvider(),
  zaiProvider(),
  zaiCodingCnProvider(),
];
