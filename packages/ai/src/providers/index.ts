import type { Provider } from '../runtime/registry.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging extension point.
export interface ProviderFactoryOptionsMap {}

export type ProviderFactoryOptions = Readonly<Record<string, unknown>>;

export interface BuiltinProviderFactoryDescriptor<
  TOptions extends ProviderFactoryOptions = ProviderFactoryOptions,
> {
  readonly kind: string;
  readonly create: (options: TOptions) => Provider | Promise<Provider>;
  readonly requiredNonSecretOptions: readonly string[];
}
