import type { ModelDefinition } from '../../core/models.js';
import type { ImageModelDefinition } from '../../images/models.js';
import type { VideoModelDefinition } from '../../videos/models.js';

export type AggregatorCapability = 'chat' | 'images' | 'videos';

export type ChannelModelDefinition =
  ModelDefinition | ImageModelDefinition | VideoModelDefinition;

export function channelModelIdentity(
  capability: AggregatorCapability,
  model: Readonly<ChannelModelDefinition>,
): string {
  return identity('model', [
    capability,
    model.providerInstanceId,
    model.id,
    model.upstreamModelId,
    model.protocol,
    model.protocolProfileId,
  ]);
}

export function channelCatalogIdentity(
  capability: AggregatorCapability,
  providerInstanceId: string,
  catalogCompatibilityVersion: string,
): string {
  return identity('catalog', [
    capability,
    requireIdentityPart(providerInstanceId, 'provider instance id'),
    requireIdentityPart(
      catalogCompatibilityVersion,
      'catalog compatibility version',
    ),
  ]);
}

export function channelOperationIdentity(
  capability: 'images' | 'videos',
  model: Readonly<ImageModelDefinition | VideoModelDefinition>,
  operationCompatibilityVersion: string,
): string {
  return identity('operation', [
    capability,
    model.providerInstanceId,
    model.id,
    model.upstreamModelId,
    model.protocol,
    model.protocolProfileId,
    requireIdentityPart(
      operationCompatibilityVersion,
      'operation compatibility version',
    ),
  ]);
}

export function assertChannelIsolation(
  left: Readonly<ChannelModelDefinition>,
  right: Readonly<ChannelModelDefinition>,
): void {
  if (left.providerInstanceId === right.providerInstanceId)
    throw new Error('channel isolation requires different Provider instances');
}

function identity(kind: string, parts: readonly string[]): string {
  return JSON.stringify(['@duoduo/ai/channel-identity', 1, kind, ...parts]);
}

function requireIdentityPart(value: string, name: string): string {
  if (value.trim() === '') throw new TypeError(`${name} must not be empty`);
  return value;
}
