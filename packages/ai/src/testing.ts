export {
  createFauxProvider,
  fauxFailure,
  fauxTextResponse,
  fauxToolResponse,
} from './testing/faux.js';
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
