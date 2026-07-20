import type { ProviderContractManifest } from '../../runtime/registry.js';
import { qwenProtocolProfiles } from './profiles.js';

export const qwenContractManifest: ProviderContractManifest = Object.freeze({
  schemaVersion: 1,
  providerKind: 'qwen',
  bindings: Object.freeze(
    qwenProtocolProfiles.map((profile) =>
      Object.freeze({
        capability: 'chat' as const,
        protocol: profile.protocol,
        profileIds: Object.freeze([profile.id]),
        authSchemes: Object.freeze(['api_key']),
        endpointBranchIds: Object.freeze([
          'cn-beijing-shared',
          'ap-southeast-1-shared',
          'us-east-1-shared',
          'cn-hongkong-shared',
          'cn-beijing-workspace',
          'ap-southeast-1-workspace',
          'cn-hongkong-workspace',
          'ap-northeast-1-workspace',
          'eu-central-1-workspace',
          'explicit-base-url',
        ]),
        requestFixtureIds: Object.freeze([
          profile.protocol === 'dashscope'
            ? `qwen_${profile.route}_request`
            : `qwen_${profile.protocol}_request`,
        ]),
        streamFixtureIds: Object.freeze([
          profile.protocol === 'dashscope'
            ? 'qwen_native_thinking_tool_stream'
            : `qwen_${profile.protocol}_stream`,
        ]),
        errorFixtureIds: Object.freeze(['qwen_invalid_request']),
        sources: Object.freeze([
          Object.freeze({
            kind: 'official' as const,
            locator:
              'https://www.alibabacloud.com/help/en/model-studio/developer-reference/use-qwen-by-calling-api',
          }),
          Object.freeze({
            kind: 'fixture' as const,
            locator: 'test/fixtures/qwen',
          }),
        ]),
      }),
    ),
  ),
});
