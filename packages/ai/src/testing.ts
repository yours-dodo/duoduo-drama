export {
  createFauxProvider,
  fauxFailure,
  fauxTextResponse,
  fauxToolResponse,
} from './testing/faux.js';
export type { MemoryCatalogStore } from './testing/memory-stores.js';
export type {
  AdditionalModelInput,
  FauxCallRecord,
  FauxController,
  FauxProviderFixture,
  FauxResponseScript,
  ScriptedProtocolChunk,
} from './testing/faux.js';
export type { FixtureProvider } from './testing/types.js';

export {
  assertResponseStart,
  assertSingleTerminal,
  assertStreamEventTypes,
  collectResponseStream,
} from './testing/assertions.js';
export type { CollectedResponseStream } from './testing/assertions.js';

export { createFixtureTransportDriver } from './transport/fixture-driver.js';
export type {
  ExpectedFixtureRequest,
  FixtureTransportDriver,
  FixtureTransportResponse,
  RedactedFixtureRequest,
} from './transport/fixture-driver.js';

export { createFakeClock } from './testing/fake-clock.js';
export type { FakeClock } from './testing/fake-clock.js';
export {
  createMemoryCredentialStore,
  createMemoryCatalogStore,
} from './testing/memory-stores.js';
