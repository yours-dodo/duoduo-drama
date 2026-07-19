import {
  createAi,
  secret,
  type AmbientAuth,
  type AmbientAuthPolicy,
} from '@duoduo/ai';
import {
  createAwsAmbientAuth,
  resolveBedrockRegion,
  type AwsRequestSigner,
} from '@duoduo/ai/auth/ambient/aws';
import {
  createGoogleAdcAmbientAuth,
  resolveGoogleAdcConfiguration,
  type GoogleAdcCredentialProvider,
} from '@duoduo/ai/auth/ambient/google-adc';
import { createAmazonBedrockProvider } from '@duoduo/ai/providers/amazon-bedrock';
import { createGoogleProvider } from '@duoduo/ai/providers/google';
import { createGoogleVertexProvider } from '@duoduo/ai/providers/google-vertex';
import { runBedrockConverseStream } from '@duoduo/ai/protocols/bedrock-converse-stream';
import { runGoogleGenerativeAi } from '@duoduo/ai/protocols/google-generative-ai';
import { runGoogleVertex } from '@duoduo/ai/protocols/google-vertex';
import {
  createAllowlistNetworkPolicy,
  type RequestAuthorizer,
} from '@duoduo/ai/transport';
import { createFixtureTransportDriver } from '@duoduo/ai/testing';

const googleCredentials: GoogleAdcCredentialProvider = {
  getAccessToken: async () => ({ token: secret('fixture-google-token') }),
  getPrincipal: async () => 'fixture@example.com',
};
const googleConfiguration = resolveGoogleAdcConfiguration({
  project: 'fixture-project',
  location: 'us-central1',
});
const googleAmbient: AmbientAuth = createGoogleAdcAmbientAuth({
  ...googleConfiguration,
  credentials: googleCredentials,
});

const awsSigner: AwsRequestSigner = {
  sign: async () => ({ authorization: secret('fixture-aws-signature') }),
};
const awsAmbient: AmbientAuth = createAwsAmbientAuth({
  region: resolveBedrockRegion({ modelId: 'eu.anthropic.claude' }),
  signer: awsSigner,
});
const ambientAuthPolicy: AmbientAuthPolicy = { allow: () => true };
const requestAuthorizer: RequestAuthorizer = async () => ({});

const ai = createAi({
  transport: createFixtureTransportDriver(),
  networkPolicy: createAllowlistNetworkPolicy({
    origins: [
      'https://generativelanguage.googleapis.com',
      'https://us-central1-aiplatform.googleapis.com',
      'https://bedrock-runtime.eu-central-1.amazonaws.com',
    ],
  }),
  ambientAuthPolicy,
});
ai.providers.register(createGoogleProvider());
ai.providers.register(
  createGoogleVertexProvider({
    authMode: 'adc',
    project: googleConfiguration.project,
    location: googleConfiguration.location,
    ambientAuth: googleAmbient,
  }),
);
ai.providers.register(
  createAmazonBedrockProvider({
    authMode: 'aws',
    region: 'eu-central-1',
    ambientAuth: awsAmbient,
  }),
);

export function compileGoogleVertexBedrockConsumer(): void {
  void requestAuthorizer;
  void runGoogleGenerativeAi;
  void runGoogleVertex;
  void runBedrockConverseStream;
}
