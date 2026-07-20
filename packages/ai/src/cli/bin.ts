#!/usr/bin/env node

import { createNodeCliDependencies } from './node.js';
import { runCli } from './runner.js';

const dependencies = await createNodeCliDependencies();
try {
  process.exitCode = await runCli(process.argv.slice(2), dependencies);
} finally {
  await dependencies.runtime.dispose();
}
