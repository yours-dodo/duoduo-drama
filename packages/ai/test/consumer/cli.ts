import {
  CLI_SKIPPED_EXIT_CODE,
  evaluateLiveRun,
  runCli,
  type NodeCliDependencies,
} from '@duoduo/ai/cli';

export async function compileCliConsumer(
  dependencies: NodeCliDependencies,
): Promise<number> {
  const decision = evaluateLiveRun(
    {
      provider: 'openai',
      model: 'fixture-model',
      capability: 'chat',
      allowPaid: false,
      estimatedMaxUsd: 0,
    },
    {},
  );
  void decision;
  void CLI_SKIPPED_EXIT_CODE;
  return runCli(['providers', '--json'], dependencies);
}
