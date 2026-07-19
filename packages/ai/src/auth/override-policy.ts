import type { ProviderSnapshot } from '../core/models.js';
import type { RequestCredentialOverride } from './api-key.js';

export interface CredentialOverridePolicy<TScopeHandle = unknown> {
  allow(
    scope: TScopeHandle,
    provider: Readonly<ProviderSnapshot>,
    override: Readonly<Pick<RequestCredentialOverride, 'type' | 'scheme'>>,
  ): Promise<boolean> | boolean;
}
