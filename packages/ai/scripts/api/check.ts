import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ExportTarget {
  readonly types: string;
  readonly import: string;
}

interface PackageManifest {
  readonly exports?: Readonly<Record<string, ExportTarget>>;
}

const protocolSymbols = Object.freeze({
  'openai-responses': Object.freeze([
    'openAiResponsesContract',
    'createOpenAiResponsesAdapter',
    'openAiResponsesReplayCodecs',
  ]),
  'openai-chat-completions': Object.freeze([
    'openAiChatCompletionsContract',
    'createOpenAiChatCompletionsAdapter',
    'openAiChatCompletionsReplayCodecs',
  ]),
  'openai-codex-responses': Object.freeze([
    'openAiCodexResponsesContract',
    'createOpenAiCodexResponsesAdapter',
    'openAiCodexResponsesReplayCodecs',
  ]),
  'azure-openai-responses': Object.freeze([
    'azureOpenAiResponsesContract',
    'createAzureOpenAiResponsesAdapter',
    'azureOpenAiResponsesReplayCodecs',
  ]),
  'anthropic-messages': Object.freeze([
    'anthropicMessagesContract',
    'createAnthropicMessagesAdapter',
    'anthropicMessagesReplayCodecs',
  ]),
  'google-generative-ai': Object.freeze([
    'googleGenerativeAiContract',
    'createGoogleGenerativeAiAdapter',
    'googleGenerativeAiReplayCodecs',
  ]),
  'google-vertex': Object.freeze([
    'googleVertexContract',
    'createGoogleVertexAdapter',
    'googleVertexReplayCodecs',
  ]),
  'bedrock-converse-stream': Object.freeze([
    'bedrockConverseStreamContract',
    'createBedrockConverseStreamAdapter',
    'bedrockConverseStreamReplayCodecs',
  ]),
  'mistral-conversations': Object.freeze([
    'mistralConversationsContract',
    'createMistralConversationsAdapter',
    'mistralConversationsReplayCodecs',
  ]),
  'pi-messages': Object.freeze([
    'piMessagesContract',
    'createPiMessagesAdapter',
    'piMessagesReplayCodecs',
  ]),
  dashscope: Object.freeze([
    'dashScopeContract',
    'createDashScopeAdapter',
    'dashScopeReplayCodecs',
  ]),
  'ark-responses': Object.freeze([
    'arkResponsesContract',
    'createArkResponsesAdapter',
    'arkResponsesReplayCodecs',
  ]),
  'openrouter-images': Object.freeze([
    'openRouterImagesContract',
    'createOpenRouterImagesAdapter',
  ]),
  'dashscope-images': Object.freeze([
    'dashScopeImagesContract',
    'createDashScopeImagesAdapter',
  ]),
  'dashscope-image-tasks': Object.freeze([
    'dashScopeImageTasksContract',
    'createDashScopeImageTasksAdapter',
  ]),
  'ark-images': Object.freeze(['arkImagesContract', 'createArkImagesAdapter']),
  'xai-images': Object.freeze(['xAiImagesContract', 'createXAiImagesAdapter']),
  'xai-videos': Object.freeze(['xAiVideosContract', 'createXAiVideosAdapter']),
  'ark-video-tasks': Object.freeze([
    'arkVideoTasksContract',
    'createArkVideoTasksAdapter',
  ]),
  'kling-video-tasks': Object.freeze([
    'klingVideoTasksContract',
    'createKlingVideoTasksAdapter',
  ]),
  'duoduo-generation-v1': Object.freeze([
    'duoduoGenerationContract',
    'createDuoduoGenerationAdapter',
  ]),
} as const);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '../..');
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const packageExports = manifest.exports ?? {};
const failures: string[] = [];
let verifiedSymbols = 0;

for (const [protocol, symbols] of Object.entries(protocolSymbols)) {
  const subpath = `./protocols/${protocol}`;
  const target = packageExports[subpath];
  if (!target) {
    failures.push(`package export ${subpath} is missing`);
    continue;
  }
  if (!isExportTarget(target)) {
    failures.push(
      `package export ${subpath} must declare types and import targets`,
    );
    continue;
  }
  const runtimePath = resolve(packageRoot, target.import);
  const declarationPath = resolve(packageRoot, target.types);
  if (!existsSync(runtimePath)) {
    failures.push(`build output for ${subpath} is missing: ${target.import}`);
    continue;
  }
  if (!existsSync(declarationPath))
    failures.push(
      `declaration output for ${subpath} is missing: ${target.types}`,
    );

  const runtime = (await import(pathToFileURL(runtimePath).href)) as Record<
    string,
    unknown
  >;
  for (const symbol of symbols) {
    if (!(symbol in runtime))
      failures.push(`${subpath} does not export runtime symbol ${symbol}`);
    else verifiedSymbols += 1;
  }
}

if (failures.length > 0) {
  process.stderr.write(`API check failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `API verified: ${Object.keys(protocolSymbols).length} protocol subpaths and ${verifiedSymbols} runtime symbols match the design inventory.\n`,
  );
}

function isExportTarget(value: unknown): value is ExportTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ExportTarget>).types === 'string' &&
    typeof (value as Partial<ExportTarget>).import === 'string'
  );
}
