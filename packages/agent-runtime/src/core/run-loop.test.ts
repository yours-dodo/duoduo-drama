import { createAi, type Message, type ModelRef } from '@duoduo/ai';
import { createFauxProvider, fauxTextResponse } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import { runAgentLoop } from './run-loop.js';
import { createEphemeralToolExecutionCoordinator } from './tool-execution.js';
import type { AgentEvent } from './types.js';

describe('runAgentLoop recovery entry', () => {
  it('continues after completed Turns without appending the prompt or replaying run_start', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('recovered answer')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const transcript = completedTurnTranscript(fixture.modelRef);
    const events: AgentEvent[] = [];

    try {
      const result = await runAgentLoop({
        ai,
        model,
        prompt: 'must not be appended again',
        transcript,
        toolExecutionCoordinator: createEphemeralToolExecutionCoordinator(),
        resume: {
          initialSequence: 40,
          nextTurnIndex: 2,
          reenterTurn: false,
          modelAttempt: 1,
        },
        modelAttemptId: ({ turn, attempt }) =>
          `model-attempt-${turn}-${attempt}`,
        emit: (event) => events.push(event),
      });

      expect(fixture.controller.callCount()).toBe(1);
      expect(fixture.controller.calls()[0]?.context.messages).toEqual(
        transcript,
      );
      expect(events.map((event) => event.type)).toEqual([
        'turn_start',
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(events.map((event) => event.sequence)).toEqual([
        41, 42, 43, 44, 45, 46,
      ]);
      expect(events[1]).toMatchObject({
        type: 'model_start',
        turn: 2,
        modelAttemptId: 'model-attempt-2-1',
        modelAttempt: 1,
      });
      expect(result).toMatchObject({ status: 'completed', turns: 2 });
      expect(result.transcript).toHaveLength(3);
    } finally {
      await ai.dispose();
    }
  });

  it('reenters one interrupted Turn with a new model Attempt but no duplicate Turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('retried interrupted turn')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const transcript: readonly Message[] = Object.freeze([]);
    const events: AgentEvent[] = [];

    try {
      await runAgentLoop({
        ai,
        model,
        prompt: 'must not be appended again',
        transcript,
        toolExecutionCoordinator: createEphemeralToolExecutionCoordinator(),
        resume: {
          initialSequence: 5,
          nextTurnIndex: 1,
          reenterTurn: true,
          modelAttempt: 2,
          appendPrompt: true,
        },
        modelAttemptId: ({ turn, attempt }) =>
          `model-attempt-${turn}-${attempt}`,
        emit: (event) => events.push(event),
      });

      expect(fixture.controller.callCount()).toBe(1);
      expect(fixture.controller.calls()[0]?.context.messages).toMatchObject([
        {
          role: 'user',
          content: [{ type: 'text', text: 'must not be appended again' }],
        },
      ]);
      expect(events.map((event) => event.type)).toEqual([
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(events[0]).toMatchObject({
        sequence: 6,
        turn: 1,
        modelAttemptId: 'model-attempt-1-2',
        modelAttempt: 2,
      });
    } finally {
      await ai.dispose();
    }
  });
});

function completedTurnTranscript(model: ModelRef): readonly Message[] {
  return Object.freeze([
    Object.freeze({
      role: 'user' as const,
      content: Object.freeze([
        Object.freeze({ type: 'text' as const, text: 'original prompt' }),
      ]),
    }),
    Object.freeze({
      role: 'assistant' as const,
      content: Object.freeze([
        Object.freeze({ type: 'text' as const, text: 'completed turn' }),
      ]),
      model,
      status: 'completed' as const,
      finishReason: 'stop' as const,
      partial: false as const,
    }),
  ]);
}
