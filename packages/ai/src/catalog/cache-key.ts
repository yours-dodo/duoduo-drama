export interface CatalogCacheKey {
  readonly capability: string;
  readonly providerInstanceId: string;
  readonly providerCatalogBindingFingerprint: string;
  readonly providerConfigFingerprint: string;
  readonly authBindingFingerprint: string;
  readonly credentialScopeFingerprint: string;
  readonly credentialInstanceId: string;
  readonly catalogVisibilityFingerprint: string;
  readonly schemaVersion: number;
}

export function canonicalizeCatalogCacheKey(key: CatalogCacheKey): string {
  const values: readonly (string | number)[] = [
    '@duoduo/ai/catalog-cache-key',
    1,
    key.capability,
    key.providerInstanceId,
    key.providerCatalogBindingFingerprint,
    key.providerConfigFingerprint,
    key.authBindingFingerprint,
    key.credentialScopeFingerprint,
    key.credentialInstanceId,
    key.catalogVisibilityFingerprint,
    key.schemaVersion,
  ];
  for (const value of values) {
    if (
      typeof value === 'string' &&
      (value.length === 0 || value.length > 1024)
    )
      throw new TypeError('invalid catalog cache key component');
    if (
      typeof value === 'number' &&
      (!Number.isSafeInteger(value) || value < 1)
    )
      throw new TypeError('invalid catalog cache schema version');
  }
  return JSON.stringify(values);
}
