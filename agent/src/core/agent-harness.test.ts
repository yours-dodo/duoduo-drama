import {
  createFauxProvider,
  fauxFailure,
  fauxTextResponse,
  fauxToolResponse,
  type FauxResponseScript,
} from '@duoduo/ai/testing';
import { AiRuntimeError } from '@duoduo/ai';
import { describe, expect, it } from 'vitest';

import {
  AgentToolExecutionError,
  createAgentHarness,
  createInMemoryAgentRuntimeStore,
  type AgentApprovalPolicyContext,
  type AgentRuntimeStore,
  type AgentTaskHandle,
  type AgentTool,
} from '../index.js';

describe('createAgentHarness', () => {
  it('loads a completed Task from an injected Runtime Store in another Harness', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('durable in-memory result')],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    const firstHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
    });
    let secondHarness:
      Awaited<ReturnType<typeof createAgentHarness>> | undefined;

    try {
      const handle = await firstHarness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'persist this Task',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      await firstHarness.dispose();

      secondHarness = await createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runtimeStore,
      });

      await expect(
        secondHarness.getTask({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
        }),
      ).resolves.toMatchObject({
        taskId: handle.taskId,
        status: 'completed',
        transcript: [
          { role: 'user' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'durable in-memory result' }],
          },
        ],
      });
    } finally {
      await secondHarness?.dispose();
      await firstHarness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('commits the terminal checkpoint, events, and outbox with Task state', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('atomically committed')],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'commit everything',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [task, checkpoint, eventPage, outbox] = await Promise.all([
        runtimeStore.getTask(query),
        runtimeStore.getCheckpoint(query),
        runtimeStore.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        runtimeStore.claimOutbox({
          workerId: 'worker-1',
          limit: 100,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        }),
      ]);

      expect(task).toMatchObject({ status: 'completed' });
      expect(checkpoint).toMatchObject({
        kind: 'run_terminal',
        version: 3,
        checkpointSchemaVersion: 3,
        resumeState: {
          kind: 'finalize',
          result: { status: 'completed', turns: 1 },
        },
        transcript: [
          { role: 'user' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'atomically committed' }],
          },
        ],
      });
      expect(eventPage.events.map((event) => event.payload.type)).toEqual([
        'run_start',
        'turn_start',
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(outbox.messages.map((message) => message.event.eventId)).toEqual(
        eventPage.events.map((event) => event.eventId),
      );
      const deliveredIds = outbox.messages
        .slice(0, 2)
        .map((message) => message.outboxId);
      const releasedId = outbox.messages[2]?.outboxId;
      if (!releasedId) throw new TypeError('Expected an outbox row to release');
      await expect(
        runtimeStore.acknowledgeOutbox({
          workerId: 'worker-1',
          outboxIds: deliveredIds,
          now: '2026-08-01T00:00:02.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 2 });
      await expect(
        runtimeStore.acknowledgeOutbox({
          workerId: 'worker-1',
          outboxIds: deliveredIds,
          now: '2026-08-01T00:00:03.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 0 });
      await expect(
        runtimeStore.releaseOutbox({
          workerId: 'worker-1',
          outboxIds: [releasedId],
          now: '2026-08-01T00:00:04.000Z',
          availableAt: '2026-08-01T00:02:00.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 1 });
      await expect(
        runtimeStore.claimOutbox({
          workerId: 'worker-2',
          limit: 100,
          now: '2026-08-01T00:00:30.000Z',
          leaseExpiresAt: '2026-08-01T00:01:30.000Z',
        }),
      ).resolves.toEqual({ messages: [] });
      const reclaimed = await runtimeStore.claimOutbox({
        workerId: 'worker-2',
        limit: 100,
        now: '2026-08-01T00:02:01.000Z',
        leaseExpiresAt: '2026-08-01T00:03:01.000Z',
      });
      expect(reclaimed.messages).toHaveLength(5);
      expect(reclaimed.messages.map((message) => message.attempt)).toEqual(
        Array(5).fill(2),
      );
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('replays committed events across Harness instances with an opaque cursor', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('cursor replay')],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    const firstHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
    });
    let secondHarness:
      Awaited<ReturnType<typeof createAgentHarness>> | undefined;

    try {
      const handle = await firstHarness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'replay this',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      await firstHarness.dispose();
      secondHarness = await createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runtimeStore,
      });
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        limit: 3,
      };

      const firstPage = await secondHarness.readEvents(query);
      const repeatedFirstPage = await secondHarness.readEvents(query);
      const secondPage = await secondHarness.readEvents({
        ...query,
        after: firstPage.nextCursor,
      });
      const thirdPage = await secondHarness.readEvents({
        ...query,
        after: secondPage.nextCursor,
      });

      expect(firstPage.events.map((event) => event.payload.type)).toEqual([
        'run_start',
        'turn_start',
        'model_start',
      ]);
      expect(firstPage).toEqual(repeatedFirstPage);
      expect(firstPage).toMatchObject({ hasMore: true });
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      expect(secondPage.events.map((event) => event.payload.type)).toEqual([
        'text_delta',
        'model_end',
        'turn_end',
      ]);
      expect(secondPage).toMatchObject({ hasMore: true });
      expect(thirdPage.events.map((event) => event.payload.type)).toEqual([
        'run_end',
      ]);
      expect(thirdPage).toMatchObject({ hasMore: false });
      await expect(
        secondHarness.readEvents({
          ...query,
          after: 'malformed-cursor',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_CURSOR_INVALID' });
      await expect(
        secondHarness.readEvents({
          ...query,
          projectId: 'foreign-project',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND' });
    } finally {
      await secondHarness?.dispose();
      await firstHarness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('normalizes invalid construction options as an initialization failure', async () => {
    const fixture = createFauxProvider();
    const duplicateTool: AgentTool = {
      definition: {
        name: 'duplicate',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({ content: [] }),
    };

    await expect(
      createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        tools: [duplicateTool, duplicateTool],
      }),
    ).rejects.toMatchObject({ code: 'AGENT_INITIALIZATION_FAILED' });
    await expect(
      createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runLease: { durationMs: 500 },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_INITIALIZATION_FAILED' });
    await expect(
      createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runLease: { durationMs: 5_000, heartbeatIntervalMs: 5_000 },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_INITIALIZATION_FAILED' });
  });

  it('sanitizes an unexpected Harness exception into one failed terminal state', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('should not escape')],
    });
    const counters = new Map<string, number>();
    let failedOnce = false;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      ids: {
        next(kind) {
          if (kind === 'event' && !failedOnce) {
            failedOnce = true;
            throw new Error('private infrastructure detail');
          }
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'hello',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);

      expect(result).toMatchObject({
        status: 'failed',
        execution: {
          status: 'failed',
          error: {
            code: 'AGENT_INTERNAL_FAILED',
            category: 'internal',
            message: 'Agent Harness execution failed unexpectedly',
          },
        },
        task: {
          status: 'failed',
          runs: [{ status: 'failed', turns: [] }],
        },
      });
      expect(JSON.stringify(result)).not.toContain(
        'private infrastructure detail',
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sequence: 2,
        payload: {
          type: 'run_end',
          result: {
            status: 'failed',
            error: { code: 'AGENT_INTERNAL_FAILED' },
          },
        },
      });
    } finally {
      await harness.dispose();
    }
  });

  it('completes one scoped task with stable Task, Run, and Turn identity', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('hello from harness')],
    });
    const counters = new Map<string, number>();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      ids: {
        next(kind) {
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: {
          tenantId: 'tenant-1',
          projectId: 'project-1',
          sessionId: 'session-1',
        },
        input: 'hello',
      });
      const events = [];

      for await (const event of handle.events) events.push(event);

      const result = await handle.result();
      const task = await harness.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
      });

      expect(handle).toMatchObject({ taskId: 'task-1', runId: 'run-1' });
      expect(result).toMatchObject({
        status: 'completed',
        taskId: 'task-1',
        runId: 'run-1',
        execution: {
          status: 'completed',
          turns: 1,
          response: {
            content: [{ type: 'text', text: 'hello from harness' }],
          },
        },
      });
      expect(task).toMatchObject({
        taskId: 'task-1',
        tenantId: 'tenant-1',
        projectId: 'project-1',
        sessionId: 'session-1',
        status: 'completed',
        latestRunId: 'run-1',
        runs: [
          {
            runId: 'run-1',
            status: 'completed',
            turns: [{ turnId: 'turn-1', turnIndex: 1, status: 'completed' }],
          },
        ],
      });
      expect(events.map((event) => event.payload.type)).toEqual([
        'run_start',
        'turn_start',
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(events.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(events[2]).toMatchObject({
        payload: {
          type: 'model_start',
          modelAttemptId: 'model_attempt-1',
          modelAttempt: 1,
        },
      });
      expect(events[3]).toMatchObject({
        payload: {
          type: 'text_delta',
          modelAttemptId: 'model_attempt-1',
          modelAttempt: 1,
        },
      });
      expect(events[4]).toMatchObject({
        payload: {
          type: 'model_end',
          modelAttemptId: 'model_attempt-1',
          modelAttempt: 1,
        },
      });
      expect(events.map((event) => event.eventId)).toEqual([
        'event-1',
        'event-2',
        'event-3',
        'event-4',
        'event-5',
        'event-6',
        'event-7',
      ]);
      expect(
        events.every(
          (event) =>
            event.tenantId === 'tenant-1' &&
            event.projectId === 'project-1' &&
            event.sessionId === 'session-1' &&
            event.taskId === 'task-1' &&
            event.runId === 'run-1',
        ),
      ).toBe(true);
      expect(
        events
          .filter((event) => event.turnIndex === 1)
          .every((event) => event.turnId === 'turn-1'),
      ).toBe(true);
      expect(task?.transcript).toMatchObject([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello from harness' }],
        },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it('keeps one Task and Run while assigning a stable ID to each tool-loop Turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'lookup-1',
          name: 'lookup',
          rawArguments: '{}',
        }),
        fauxTextResponse('done'),
      ],
    });
    const counters = new Map<string, number>();
    const lookup: AgentTool = {
      definition: {
        name: 'lookup',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({
        content: [{ type: 'text', text: 'tool result' }],
      }),
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [lookup],
      ids: {
        next(kind) {
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'lookup',
      });
      const events = [];
      for await (const event of handle.events) events.push(event);
      const result = await handle.result();
      const task = await harness.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
      });

      expect(result).toMatchObject({ status: 'completed' });
      expect(task).toMatchObject({
        taskId: 'task-1',
        latestRunId: 'run-1',
        runs: [
          {
            runId: 'run-1',
            status: 'completed',
            turns: [
              { turnId: 'turn-1', turnIndex: 1, status: 'completed' },
              { turnId: 'turn-2', turnIndex: 2, status: 'completed' },
            ],
          },
        ],
      });
      expect(
        events
          .filter((event) => event.turnIndex === 1)
          .every((event) => event.turnId === 'turn-1'),
      ).toBe(true);
      expect(
        events
          .filter((event) => event.turnIndex === 2)
          .every((event) => event.turnId === 'turn-2'),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('evaluates an explicit allow policy with validated arguments before preserving the A3 execution path', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-allow-call-1',
          name: 'approval-allow-tool',
          rawArguments: '{"value":"validated"}',
        }),
        fauxTextResponse('approval allow complete'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let policyContext: AgentApprovalPolicyContext | undefined;
    let invocationCount = 0;
    const tool: AgentTool = {
      definition: {
        name: 'approval-allow-tool',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invocationCount += 1;
        return { content: [{ type: 'text', text: 'approved result' }] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
      runtimeStore,
      approvalPolicy: {
        policyId: 'project-tool-approval',
        version: 'v1',
        evaluate(context) {
          policyContext = context;
          return { decision: 'allow' };
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'run the allowed tool',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const execution = (
        await harness.readToolExecutions({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
          runId: handle.runId,
        })
      ).executions[0];

      expect(result.status).toBe('completed');
      expect(invocationCount).toBe(1);
      expect(execution).toMatchObject({
        toolCallId: 'approval-allow-call-1',
        status: 'succeeded',
        attemptCount: 1,
      });
      expect(policyContext).toEqual({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        taskId: handle.taskId,
        runId: handle.runId,
        turnId: expect.any(String),
        turnIndex: 1,
        toolExecutionId: execution?.toolExecutionId,
        toolCallId: 'approval-allow-call-1',
        toolName: 'approval-allow-tool',
        arguments: { value: 'validated' },
        argumentsDigest: execution?.argumentsDigest,
        execution: tool.execution,
      });
      expect(
        events
          .map((event) => event.payload.type)
          .filter((type) => type.startsWith('tool_execution_')),
      ).toEqual(['tool_execution_start', 'tool_execution_end']);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('includes approval policy identity and version in the checkpoint config fingerprint', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('policy v1'),
        fauxTextResponse('policy v2'),
      ],
    });
    const fingerprints: string[] = [];

    for (const version of ['v1', 'v2']) {
      const baseStore = createInMemoryAgentRuntimeStore();
      const runtimeStore = forwardRuntimeStore(baseStore, {
        async createTask(command) {
          fingerprints.push(command.checkpoint.configFingerprint);
          return baseStore.createTask(command);
        },
      });
      const harness = await createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runtimeStore,
        approvalPolicy: {
          policyId: 'project-tool-approval',
          version,
          evaluate: () => ({ decision: 'allow' }),
        },
      });

      try {
        const handle = await harness.startTask({
          scope: { tenantId: 'tenant-1', projectId: 'project-1' },
          input: `run with policy ${version}`,
        });
        await Promise.all([collect(handle.events), handle.result()]);
      } finally {
        await harness.dispose();
        await baseStore.dispose();
      }
    }

    expect(fingerprints).toHaveLength(2);
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it('rejects empty approval policy identity or version during initialization', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('unused')],
    });

    await expect(
      createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        approvalPolicy: {
          policyId: ' ',
          version: 'v1',
          evaluate: () => ({ decision: 'allow' }),
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_INITIALIZATION_FAILED' });
    await expect(
      createAgentHarness({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        approvalPolicy: {
          policyId: 'project-tool-approval',
          version: '',
          evaluate: () => ({ decision: 'allow' }),
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_INITIALIZATION_FAILED' });
  });

  it('denies a valid tool proposal with zero Attempts and lets the model continue', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'policy-denied-call-1',
          name: 'policy-denied-tool',
          rawArguments: '{"value":"valid"}',
        }),
        fauxTextResponse('continued after policy denial'),
      ],
    });
    let invocationCount = 0;
    const tool: AgentTool = {
      definition: {
        name: 'policy-denied-tool',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invocationCount += 1;
        return { content: [{ type: 'text', text: 'must not execute' }] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
      approvalPolicy: {
        policyId: 'project-tool-approval',
        version: 'v1',
        evaluate: () => ({
          decision: 'deny',
          reasonCode: 'BUSINESS_RULE_DENIED',
        }),
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'try the denied tool',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const execution = (
        await harness.readToolExecutions({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
          runId: handle.runId,
        })
      ).executions[0];

      expect(invocationCount).toBe(0);
      expect(result).toMatchObject({
        status: 'completed',
        execution: {
          status: 'completed',
          turns: 2,
          response: {
            content: [{ type: 'text', text: 'continued after policy denial' }],
          },
          transcript: [
            { role: 'user' },
            { role: 'assistant' },
            {
              role: 'tool_result',
              toolCallId: 'policy-denied-call-1',
              isError: true,
              content: [{ type: 'text', text: 'Tool execution denied' }],
            },
            { role: 'assistant' },
          ],
        },
      });
      expect(execution).toMatchObject({
        status: 'failed',
        effectOutcome: 'not_applied',
        attemptCount: 0,
        attempts: [],
        transitions: [
          { sequence: 1, to: 'proposed' },
          {
            sequence: 2,
            from: 'proposed',
            to: 'failed',
            reasonCode: 'POLICY_DENIED',
          },
        ],
      });
      expect(
        events
          .map((event) => event.payload.type)
          .filter((type) => type.startsWith('approval_')),
      ).toEqual([]);
      expect(
        events.find((event) => event.payload.type === 'tool_execution_end')
          ?.payload,
      ).toMatchObject({
        attempt: 0,
        status: 'failed',
        effectOutcome: 'not_applied',
      });
    } finally {
      await harness.dispose();
    }
  });

  it.each([
    {
      name: 'thrown policy error',
      evaluate: () => {
        throw new Error('raw-policy-canary');
      },
    },
    {
      name: 'invalid policy result',
      evaluate: () => null as never,
    },
  ])('fails closed for $name', async ({ evaluate }) => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'policy-failed-call-1',
          name: 'policy-failed-tool',
          rawArguments: '{}',
        }),
      ],
    });
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: {
            name: 'policy-failed-tool',
            inputSchema: { type: 'object', additionalProperties: false },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => {
            invocationCount += 1;
            return { content: [{ type: 'text', text: 'must not execute' }] };
          },
        },
      ],
      approvalPolicy: {
        policyId: 'project-tool-approval',
        version: 'v1',
        evaluate,
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'trigger policy failure',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const execution = (
        await harness.readToolExecutions({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
          runId: handle.runId,
        })
      ).executions[0];

      expect(invocationCount).toBe(0);
      expect(result).toMatchObject({
        status: 'failed',
        task: { status: 'failed' },
        execution: {
          status: 'failed',
          error: {
            code: 'AGENT_APPROVAL_POLICY_FAILED',
            category: 'approval',
            retryable: false,
          },
        },
      });
      expect(execution).toMatchObject({
        status: 'failed',
        effectOutcome: 'not_applied',
        attemptCount: 0,
        attempts: [],
        transitions: [
          { sequence: 1, to: 'proposed' },
          {
            sequence: 2,
            from: 'proposed',
            to: 'failed',
            reasonCode: 'POLICY_FAILED',
          },
        ],
      });
      expect(JSON.stringify({ result, events })).not.toContain(
        'raw-policy-canary',
      );
    } finally {
      await harness.dispose();
    }
  });

  it('fails closed when an approval presentation exceeds its safe bound', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-presentation-call-1',
          name: 'approval-presentation-tool',
          rawArguments: '{}',
        }),
      ],
    });
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: {
            name: 'approval-presentation-tool',
            inputSchema: { type: 'object', additionalProperties: false },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => {
            invocationCount += 1;
            return { content: [{ type: 'text', text: 'must not execute' }] };
          },
        },
      ],
      approvalPolicy: {
        policyId: 'story-publish-policy',
        version: 'v1',
        evaluate: () => ({
          decision: 'require_approval',
          expiresAt: '2026-08-01T01:00:00.000Z',
          presentation: { title: 'x'.repeat(33 * 1024) },
        }),
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'reject the unsafe presentation',
      });
      const result = await handle.result();
      const execution = (
        await harness.readToolExecutions({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
          runId: handle.runId,
        })
      ).executions[0];

      expect(invocationCount).toBe(0);
      expect(result).toMatchObject({
        status: 'failed',
        execution: {
          error: {
            code: 'AGENT_APPROVAL_PRESENTATION_INVALID',
            category: 'approval',
          },
        },
      });
      expect(execution).toMatchObject({
        status: 'failed',
        attemptCount: 0,
        transitions: [
          { sequence: 1, to: 'proposed' },
          { sequence: 2, to: 'failed', reasonCode: 'PRESENTATION_INVALID' },
        ],
      });
    } finally {
      await harness.dispose();
    }
  });

  it('durably waits on a pending Approval with zero Attempts and an open Task handle', async () => {
    const rawArgumentCanary = 'raw-approval-argument-canary';
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-pending-call-1',
          name: 'approval-pending-tool',
          rawArguments: JSON.stringify({ secret: rawArgumentCanary }),
        }),
        fauxTextResponse('pending approval cleanup complete'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [
        {
          definition: {
            name: 'approval-pending-tool',
            inputSchema: {
              type: 'object',
              properties: { secret: { type: 'string' } },
              required: ['secret'],
              additionalProperties: false,
            },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
          execute: async () => {
            invocationCount += 1;
            return { content: [{ type: 'text', text: 'must not execute' }] };
          },
        },
      ],
      approvalPolicy: {
        policyId: 'story-publish-policy',
        version: 'v1',
        evaluate: () => ({
          decision: 'require_approval',
          expiresAt: '2026-08-01T01:00:00.000Z',
          presentation: {
            title: 'Publish story',
            description: 'Publish the reviewed story to production.',
            fields: [{ label: 'Target', value: 'Production' }],
          },
        }),
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await harness.startTask({
      scope: { tenantId: 'tenant-1', projectId: 'project-1' },
      input: 'publish the story',
    });
    const iterator = handle.events[Symbol.asyncIterator]();
    let requestedEvent:
      Awaited<ReturnType<typeof iterator.next>>['value'] | undefined;
    for (let index = 0; index < 20; index += 1) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.payload.type === 'approval_requested') {
        requestedEvent = next.value;
        break;
      }
    }
    let resultSettled = false;
    void handle.result().finally(() => {
      resultSettled = true;
    });
    await Promise.resolve();
    const query = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      taskId: handle.taskId,
      runId: handle.runId,
    };
    const [task, checkpoint, executions, approvals, outbox] = await Promise.all(
      [
        harness.getTask(query),
        runtimeStore.getCheckpoint(query),
        harness.readToolExecutions(query),
        runtimeStore.readApprovals(query),
        runtimeStore.claimOutbox({
          workerId: 'approval-worker',
          limit: 100,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        }),
      ],
    );

    expect(resultSettled).toBe(false);
    expect(invocationCount).toBe(0);
    expect(task).toMatchObject({
      status: 'waiting_for_approval',
      runs: [{ status: 'waiting_for_approval' }],
    });
    expect(checkpoint).toMatchObject({
      kind: 'approval_waiting',
      executionPosition: 'approval',
      turnIndex: 1,
    });
    expect(executions.executions).toMatchObject([
      {
        status: 'awaiting_approval',
        attemptCount: 0,
        attempts: [],
      },
    ]);
    expect(approvals).toMatchObject([
      {
        approvalId: expect.any(String),
        toolExecutionId: executions.executions[0]?.toolExecutionId,
        policyId: 'story-publish-policy',
        policyVersion: 'v1',
        status: 'pending',
        presentation: {
          title: 'Publish story',
          fields: [{ label: 'Target', value: 'Production' }],
        },
      },
    ]);
    expect(requestedEvent?.payload).toMatchObject({
      type: 'approval_requested',
      approvalId: approvals[0]?.approvalId,
      toolExecutionId: executions.executions[0]?.toolExecutionId,
      policyId: 'story-publish-policy',
      policyVersion: 'v1',
    });
    expect(outbox.messages.at(-1)?.event.payload.type).toBe(
      'approval_requested',
    );
    expect(JSON.stringify({ approvals, requestedEvent })).not.toContain(
      rawArgumentCanary,
    );
    await harness.decideApproval({
      ...query,
      approvalId: approvals[0]!.approvalId,
      decisionId: 'pending-cleanup-decision',
      decision: 'approved',
      decidedBy: 'test-cleanup',
    });
    await handle.result();
    await harness.dispose();
    await runtimeStore.dispose();
  });

  it('approves, consumes, and resumes one waiting tool execution exactly once', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-resume-call-1',
          name: 'approval-resume-tool',
          rawArguments: '{"value":"approved"}',
        }),
        fauxTextResponse('approval resume complete'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [
        {
          definition: {
            name: 'approval-resume-tool',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
          execute: async () => {
            invocationCount += 1;
            return { content: [{ type: 'text', text: 'approved result' }] };
          },
        },
      ],
      approvalPolicy: {
        policyId: 'story-publish-policy',
        version: 'v1',
        evaluate: () => ({
          decision: 'require_approval',
          expiresAt: '2026-08-01T01:00:00.000Z',
          presentation: { title: 'Publish story' },
        }),
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'approve and publish',
      });
      const iterator = handle.events[Symbol.asyncIterator]();
      const observedEvents = [];
      let approvalId: string | undefined;
      for (let index = 0; index < 20; index += 1) {
        const next = await iterator.next();
        if (next.done) break;
        observedEvents.push(next.value);
        if (next.value.payload.type === 'approval_requested') {
          approvalId = next.value.payload.approvalId;
          break;
        }
      }
      expect(approvalId).toEqual(expect.any(String));

      const decision = await harness.decideApproval({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: approvalId!,
        decisionId: 'approval-decision-1',
        decision: 'approved',
        decidedBy: 'user-1',
        reasonCode: 'HUMAN_APPROVED',
      });
      const remainingEvents = (async () => {
        for (;;) {
          const next = await iterator.next();
          if (next.done) return;
          observedEvents.push(next.value);
        }
      })();
      const [result] = await Promise.all([handle.result(), remainingEvents]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [approvals, executions, checkpoints] = await Promise.all([
        runtimeStore.readApprovals(query),
        harness.readToolExecutions(query),
        runtimeStore.readCheckpoints(query),
      ]);

      expect(decision).toMatchObject({
        approvalId,
        status: 'approved',
        decisionId: 'approval-decision-1',
        decision: 'approved',
        decidedBy: 'user-1',
        decisionReasonCode: 'HUMAN_APPROVED',
      });
      expect(result).toMatchObject({
        status: 'completed',
        execution: {
          status: 'completed',
          response: {
            content: [{ type: 'text', text: 'approval resume complete' }],
          },
        },
      });
      expect(invocationCount).toBe(1);
      expect(approvals).toMatchObject([
        {
          approvalId,
          status: 'approved',
          consumedAt: expect.any(String),
          consumeId: expect.any(String),
          transitions: [
            { sequence: 1, to: 'pending' },
            {
              sequence: 2,
              from: 'pending',
              to: 'approved',
              decisionId: 'approval-decision-1',
            },
            {
              sequence: 3,
              from: 'approved',
              to: 'approved',
              consumeId: expect.any(String),
              reasonCode: 'CONSUMED',
            },
          ],
        },
      ]);
      expect(executions.executions).toMatchObject([
        {
          status: 'succeeded',
          attemptCount: 1,
          attempts: [{ attempt: 1, status: 'succeeded' }],
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, to: 'awaiting_approval' },
            { sequence: 3, to: 'prepared' },
            { sequence: 4, to: 'running' },
            { sequence: 5, to: 'succeeded' },
          ],
        },
      ]);
      expect(checkpoints.map((checkpoint) => checkpoint.kind)).toEqual([
        'input_accepted',
        'model_completed',
        'approval_waiting',
        'approval_resolved',
        'tool_result_appended',
        'model_completed',
        'run_terminal',
      ]);
      expect(checkpoints.map((checkpoint) => checkpoint.resumeState)).toEqual([
        { kind: 'model', nextTurnIndex: 1 },
        { kind: 'tool', turnIndex: 1, nextProposalSequence: 1 },
        expect.objectContaining({
          kind: 'approval',
          turnIndex: 1,
          approvalId: expect.any(String),
          toolExecutionId: expect.any(String),
        }),
        { kind: 'tool', turnIndex: 1, nextProposalSequence: 1 },
        { kind: 'model', nextTurnIndex: 2 },
        expect.objectContaining({ kind: 'finalize' }),
        expect.objectContaining({ kind: 'finalize' }),
      ]);
      expect(
        observedEvents
          .map((event) => event.payload.type)
          .filter(
            (type) =>
              type.startsWith('approval_') ||
              type.startsWith('tool_execution_'),
          ),
      ).toEqual([
        'approval_requested',
        'approval_decided',
        'tool_execution_start',
        'tool_execution_end',
      ]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('pages scoped Approvals with opaque cursors and safe public events', async () => {
    const rawArgumentCanaries = [
      'approval-argument-canary-1',
      'approval-argument-canary-2',
    ];
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-paged-call-1',
          name: 'approval-paged-tool',
          rawArguments: `{"secret":"${rawArgumentCanaries[0]}"}`,
        }),
        fauxToolResponse({
          id: 'approval-paged-call-2',
          name: 'approval-paged-tool',
          rawArguments: `{"secret":"${rawArgumentCanaries[1]}"}`,
        }),
        fauxTextResponse('approval paging complete'),
      ],
    });
    const otherFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('other scoped task')],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [
        {
          definition: {
            name: 'approval-paged-tool',
            inputSchema: {
              type: 'object',
              properties: { secret: { type: 'string' } },
              required: ['secret'],
              additionalProperties: false,
            },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
          execute: async () => ({
            content: [{ type: 'text', text: 'approved' }],
          }),
        },
      ],
      approvalPolicy: {
        policyId: 'paged-approval-policy',
        version: 'v1',
        evaluate: (context) => ({
          decision: 'require_approval',
          expiresAt: '2026-08-01T01:00:00.000Z',
          presentation: { title: `Review ${context.toolCallId}` },
        }),
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    let otherHarness:
      Awaited<ReturnType<typeof createAgentHarness>> | undefined;

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'page approvals',
      });
      const iterator = handle.events[Symbol.asyncIterator]();
      const observedEvents: import('../index.js').AgentHarnessEvent[] = [];
      const firstRequest = await waitForNextApprovalRequest(
        iterator,
        observedEvents,
      );
      await harness.decideApproval({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: firstRequest.approvalId,
        decisionId: 'approval-page-decision-1',
        decision: 'approved',
        decidedBy: 'user-1',
      });
      const secondRequest = await waitForNextApprovalRequest(
        iterator,
        observedEvents,
      );
      await harness.decideApproval({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: secondRequest.approvalId,
        decisionId: 'approval-page-decision-2',
        decision: 'approved',
        decidedBy: 'user-1',
      });
      const remainingEvents = collectIterator(iterator);
      await handle.result();
      observedEvents.push(...(await remainingEvents));

      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        limit: 1,
      };
      const first = await harness.readApprovals(query);
      const repeated = await harness.readApprovals(query);
      const second = await harness.readApprovals({
        ...query,
        after: first.nextCursor,
      });
      const third = await harness.readApprovals({
        ...query,
        after: second.nextCursor,
      });
      const eventPage = await harness.readEvents({ ...query, limit: 100 });
      const executionPage = await harness.readToolExecutions({
        ...query,
        limit: 100,
      });

      expect(first).toEqual(repeated);
      expect(first).toMatchObject({
        hasMore: true,
        approvals: [
          {
            approvalId: firstRequest.approvalId,
            proposalSequence: 1,
            presentation: { title: 'Review approval-paged-call-1' },
          },
        ],
      });
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(second).toMatchObject({
        hasMore: false,
        approvals: [
          {
            approvalId: secondRequest.approvalId,
            proposalSequence: 2,
            presentation: { title: 'Review approval-paged-call-2' },
          },
        ],
      });
      expect(third).toEqual({ approvals: [], hasMore: false });
      await expect(
        harness.readApprovals({ ...query, after: 'not-a-cursor' }),
      ).rejects.toMatchObject({ code: 'AGENT_CURSOR_INVALID' });
      await expect(
        harness.readApprovals({ ...query, limit: 0 }),
      ).rejects.toThrow('Agent Approval page limit must be between 1 and 500');
      await expect(
        runtimeStore.readApprovals({ ...query, projectId: 'project-foreign' }),
      ).resolves.toEqual([]);

      otherHarness = await createAgentHarness({
        providers: [otherFixture.provider],
        model: { ref: otherFixture.modelRef, scope: {} },
        runtimeStore,
      });
      const otherHandle = await otherHarness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-2' },
        input: 'create another scoped run',
      });
      await Promise.all([collect(otherHandle.events), otherHandle.result()]);
      await expect(
        otherHarness.readApprovals({
          tenantId: 'tenant-1',
          projectId: 'project-2',
          taskId: otherHandle.taskId,
          runId: otherHandle.runId,
          after: first.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_CURSOR_INVALID' });

      const serializedPublicData = JSON.stringify({
        approvals: [first, second],
        events: eventPage.events,
      });
      for (const canary of rawArgumentCanaries)
        expect(serializedPublicData).not.toContain(canary);
      for (const execution of executionPage.executions) {
        expect(execution.idempotencyKey).toEqual(expect.any(String));
        expect(serializedPublicData).not.toContain(execution.idempotencyKey);
      }
      expect(
        observedEvents
          .filter((event) => event.payload.type.startsWith('approval_'))
          .map((event) => event.payload.type),
      ).toEqual([
        'approval_requested',
        'approval_decided',
        'approval_requested',
        'approval_decided',
      ]);
    } finally {
      await otherHarness?.dispose();
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('consumes a denied Approval with zero Attempts and lets the model continue', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-denied-call-1',
          name: 'approval-terminal-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('continued after approval denial'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [approvalTerminalTool(() => (invocationCount += 1))],
      approvalPolicy: requireTestApproval('2026-08-01T01:00:00.000Z'),
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'deny this action',
      });
      const requested = await waitForApprovalRequest(handle);
      await harness.decideApproval({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: requested.approvalId,
        decisionId: 'approval-denied-decision-1',
        decision: 'denied',
        decidedBy: 'user-1',
        reasonCode: 'HUMAN_DENIED',
      });
      const [result, remainingEvents] = await Promise.all([
        handle.result(),
        collectIterator(requested.iterator),
      ]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [approvals, executions] = await Promise.all([
        runtimeStore.readApprovals(query),
        harness.readToolExecutions(query),
      ]);

      expect(invocationCount).toBe(0);
      expect(result).toMatchObject({
        status: 'completed',
        execution: {
          turns: 2,
          transcript: [
            { role: 'user' },
            { role: 'assistant' },
            {
              role: 'tool_result',
              isError: true,
              content: [{ type: 'text', text: 'Tool execution denied' }],
            },
            { role: 'assistant' },
          ],
        },
      });
      expect(approvals).toMatchObject([
        {
          status: 'denied',
          consumedAt: expect.any(String),
          transitions: [
            { to: 'pending' },
            { from: 'pending', to: 'denied' },
            { from: 'denied', to: 'denied', reasonCode: 'CONSUMED' },
          ],
        },
      ]);
      expect(executions.executions).toMatchObject([
        {
          status: 'failed',
          effectOutcome: 'not_applied',
          attemptCount: 0,
          attempts: [],
        },
      ]);
      expect(
        [...requested.events, ...remainingEvents]
          .map((event) => event.payload.type)
          .filter(
            (type) =>
              type.startsWith('approval_') ||
              type.startsWith('tool_execution_'),
          ),
      ).toEqual([
        'approval_requested',
        'approval_decided',
        'tool_execution_end',
      ]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('expires a pending Approval online and continues with zero Attempts', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-expired-call-1',
          name: 'approval-terminal-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('continued after approval expiry'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let now = '2026-08-01T00:00:00.000Z';
    let fireExpiry: (() => void) | undefined;
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [approvalTerminalTool(() => (invocationCount += 1))],
      approvalPolicy: requireTestApproval('2026-08-01T00:00:01.000Z'),
      clock: { now: () => now },
      durableEventBatch: { maxEvents: 1 },
      timer: {
        schedule(delayMs, callback) {
          if (delayMs === 1_000) fireExpiry = callback;
          return () => {
            if (fireExpiry === callback) fireExpiry = undefined;
          };
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'let this approval expire',
      });
      const requested = await waitForApprovalRequest(handle);
      expect(fireExpiry).toEqual(expect.any(Function));
      now = '2026-08-01T00:00:01.000Z';
      fireExpiry!();
      const [result, remainingEvents] = await Promise.all([
        handle.result(),
        collectIterator(requested.iterator),
      ]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [approvals, executions] = await Promise.all([
        runtimeStore.readApprovals(query),
        harness.readToolExecutions(query),
      ]);

      expect(result.status).toBe('completed');
      expect(invocationCount).toBe(0);
      expect(approvals).toMatchObject([
        { status: 'expired', consumedAt: expect.any(String) },
      ]);
      expect(executions.executions).toMatchObject([
        {
          status: 'failed',
          effectOutcome: 'not_applied',
          attemptCount: 0,
        },
      ]);
      expect(
        [...requested.events, ...remainingEvents]
          .map((event) => event.payload.type)
          .filter((type) => type.startsWith('approval_')),
      ).toEqual(['approval_requested', 'approval_expired']);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('cancels and consumes a pending Approval without invoking the tool', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-cancelled-call-1',
          name: 'approval-terminal-tool',
          rawArguments: '{}',
        }),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [approvalTerminalTool(() => (invocationCount += 1))],
      approvalPolicy: requireTestApproval('2026-08-01T01:00:00.000Z'),
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'cancel this approval',
      });
      const requested = await waitForApprovalRequest(handle);
      const disposePromise = harness.dispose();
      const [result, remainingEvents] = await Promise.all([
        handle.result(),
        collectIterator(requested.iterator),
      ]);
      await disposePromise;
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [approvals, executions] = await Promise.all([
        runtimeStore.readApprovals(query),
        harness.readToolExecutions(query),
      ]);

      expect(result.status).toBe('cancelled');
      expect(invocationCount).toBe(0);
      expect(approvals).toMatchObject([
        { status: 'cancelled', consumedAt: expect.any(String) },
      ]);
      expect(executions.executions).toMatchObject([
        {
          status: 'failed',
          effectOutcome: 'not_applied',
          attemptCount: 0,
        },
      ]);
      expect(
        [...requested.events, ...remainingEvents]
          .map((event) => event.payload.type)
          .filter((type) => type.startsWith('approval_')),
      ).toEqual(['approval_requested', 'approval_cancelled']);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('commits and exposes one successful tool execution ledger lifecycle', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'ledger-call-1',
          name: 'ledger-tool',
          rawArguments: '{"value":"ok"}',
        }),
        fauxTextResponse('ledger complete'),
      ],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const commits: Parameters<AgentRuntimeStore['commitTask']>[0][] = [];
    const runtimeStore = forwardRuntimeStore(baseStore, {
      async commitTask(command) {
        commits.push(command);
        return baseStore.commitTask(command);
      },
    });
    let receivedContext:
      | {
          toolExecutionId: string;
          attempt: number;
          idempotencyKey?: string;
          deadline: string;
        }
      | undefined;
    const tool: AgentTool = {
      definition: {
        name: 'ledger-tool',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'reversible',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async (_arguments, context) => {
        receivedContext = {
          toolExecutionId: context.toolExecutionId,
          attempt: context.attempt,
          idempotencyKey: context.idempotencyKey,
          deadline: context.deadline,
        };
        return { content: [{ type: 'text', text: 'ledger result' }] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
      runtimeStore,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'run the ledger tool',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const page = await harness.readToolExecutions(query);
      const execution = page.executions[0];

      expect(page).toMatchObject({ hasMore: false });
      expect(execution).toMatchObject({
        toolCallId: 'ledger-call-1',
        toolName: 'ledger-tool',
        status: 'succeeded',
        effectOutcome: 'applied',
        sideEffect: 'reversible',
        idempotency: 'keyed',
        timeoutMs: 30_000,
        attemptCount: 1,
        attempts: [{ attempt: 1, status: 'succeeded' }],
        transitions: [
          { sequence: 1, to: 'proposed' },
          { sequence: 2, from: 'proposed', to: 'prepared' },
          { sequence: 3, from: 'prepared', to: 'running' },
          { sequence: 4, from: 'running', to: 'succeeded' },
        ],
      });
      expect(receivedContext).toEqual({
        toolExecutionId: execution?.toolExecutionId,
        attempt: 1,
        idempotencyKey: execution?.idempotencyKey,
        deadline: execution?.deadline,
      });

      const runningCommit = commits.find((command) =>
        command.toolExecutions?.some(
          (mutation) => mutation.type === 'tool_execution_started',
        ),
      );
      const terminalCommit = commits.find((command) =>
        command.toolExecutions?.some(
          (mutation) => mutation.type === 'tool_execution_finished',
        ),
      );
      expect(runningCommit).toMatchObject({
        events: [{ payload: { type: 'tool_execution_start' } }],
      });
      expect(terminalCommit).toMatchObject({
        checkpoint: { kind: 'tool_result_appended' },
        events: [{ payload: { type: 'tool_execution_end' } }],
      });

      const outbox = await baseStore.claimOutbox({
        workerId: 'ledger-worker',
        limit: 100,
        now: '2026-08-01T00:00:01.000Z',
        leaseExpiresAt: '2026-08-01T00:01:01.000Z',
      });
      expect(
        outbox.messages
          .map((message) => message.event.payload.type)
          .filter((type) => type.startsWith('tool_execution_')),
      ).toEqual(['tool_execution_start', 'tool_execution_end']);
    } finally {
      await harness.dispose();
      await baseStore.dispose();
    }
  });

  it('pages tool executions with a scope-bound opaque cursor and safe events', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'paged-call-1',
          name: 'paged-tool',
          rawArguments: '{"secret":"argument-canary-1"}',
        }),
        fauxToolResponse({
          id: 'paged-call-2',
          name: 'paged-tool',
          rawArguments: '{"secret":"argument-canary-2"}',
        }),
        fauxTextResponse('paging complete'),
      ],
    });
    const tool: AgentTool = {
      definition: {
        name: 'paged-tool',
        inputSchema: {
          type: 'object',
          properties: { secret: { type: 'string' } },
          required: ['secret'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async () => ({ content: [{ type: 'text', text: 'done' }] }),
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'page tool executions',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const query = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        limit: 1,
      };
      const first = await harness.readToolExecutions(query);
      const repeated = await harness.readToolExecutions(query);
      const second = await harness.readToolExecutions({
        ...query,
        after: first.nextCursor,
      });
      const eventPage = await harness.readEvents({ ...query, limit: 100 });

      expect(first).toEqual(repeated);
      expect(first).toMatchObject({
        hasMore: true,
        executions: [{ toolCallId: 'paged-call-1' }],
      });
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(second).toMatchObject({
        hasMore: false,
        executions: [{ toolCallId: 'paged-call-2' }],
      });
      await expect(
        harness.readToolExecutions({
          ...query,
          projectId: 'project-2',
          after: first.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND' });
      await expect(
        harness.readToolExecutions({
          ...query,
          taskId: `${handle.taskId}-different`,
          after: first.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND' });
      await expect(
        harness.readToolExecutions({ ...query, after: 'not-a-cursor' }),
      ).rejects.toMatchObject({ code: 'AGENT_CURSOR_INVALID' });

      const serializedEvents = JSON.stringify(eventPage.events);
      expect(serializedEvents).not.toContain('argument-canary');
      expect(first.executions[0]?.idempotencyKey).toEqual(expect.any(String));
      expect(serializedEvents).not.toContain(
        first.executions[0]?.idempotencyKey,
      );
      expect(
        eventPage.events
          .filter(
            (event) =>
              event.payload.type === 'tool_execution_start' ||
              event.payload.type === 'tool_execution_end',
          )
          .every(
            (event) =>
              'toolExecutionId' in event.payload && 'attempt' in event.payload,
          ),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('records unavailable and invalid tool proposals as failed without attempts', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'missing-call',
          name: 'missing-tool',
          rawArguments: '{}',
        }),
        fauxToolResponse({
          id: 'invalid-json-call',
          name: 'validated-tool',
          rawArguments: '{',
        }),
        fauxToolResponse({
          id: 'invalid-schema-call',
          name: 'validated-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('rejections handled'),
      ],
    });
    let invoked = false;
    const tool: AgentTool = {
      definition: {
        name: 'validated-tool',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invoked = true;
        return { content: [] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'reject invalid proposals',
      });
      const [events] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const page = await harness.readToolExecutions({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(invoked).toBe(false);
      expect(page.executions).toHaveLength(3);
      expect(page.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolCallId: 'missing-call',
            status: 'failed',
            effectOutcome: 'not_applied',
            attemptCount: 0,
            attempts: [],
          }),
          expect.objectContaining({
            toolCallId: 'invalid-json-call',
            status: 'failed',
            effectOutcome: 'not_applied',
            attemptCount: 0,
            attempts: [],
          }),
          expect.objectContaining({
            toolCallId: 'invalid-schema-call',
            status: 'failed',
            effectOutcome: 'not_applied',
            attemptCount: 0,
            attempts: [],
          }),
        ]),
      );
      expect(
        page.executions.every(
          (execution) =>
            execution.transitions.length === 2 &&
            execution.transitions[1]?.from === 'proposed' &&
            execution.transitions[1]?.to === 'failed',
        ),
      ).toBe(true);
      expect(
        events.filter((event) => event.payload.type === 'tool_execution_start'),
      ).toHaveLength(0);
      expect(
        events.filter((event) => event.payload.type === 'tool_execution_end'),
      ).toHaveLength(3);
    } finally {
      await harness.dispose();
    }
  });

  it('classifies ordinary and structured tool failures without leaking causes', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'external-failure-call',
          name: 'external-failure',
          rawArguments: '{}',
        }),
        fauxToolResponse({
          id: 'pure-failure-call',
          name: 'pure-failure',
          rawArguments: '{}',
        }),
        fauxToolResponse({
          id: 'structured-failure-call',
          name: 'structured-failure',
          rawArguments: '{}',
        }),
        fauxTextResponse('failures classified'),
      ],
    });
    const tool = (
      name: string,
      sideEffect: AgentTool['execution']['sideEffect'],
      execute: AgentTool['execute'],
    ): AgentTool => ({
      definition: {
        name,
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: { sideEffect, idempotency: 'none', timeoutMs: 30_000 },
      execute,
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        tool('external-failure', 'external', async () => {
          throw new Error('external-secret-canary');
        }),
        tool('pure-failure', 'none', async () => {
          throw new Error('pure-secret-canary');
        }),
        tool('structured-failure', 'external', async () => {
          throw new AgentToolExecutionError({
            code: 'UPSTREAM_REJECTED_BEFORE_WRITE',
            kind: 'failed',
            effectOutcome: 'not_applied',
            retryable: true,
          });
        }),
      ],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'classify failures',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const page = await harness.readToolExecutions({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });
      const byCall = new Map(
        page.executions.map((execution) => [execution.toolCallId, execution]),
      );

      expect(byCall.get('external-failure-call')).toMatchObject({
        status: 'unknown',
        effectOutcome: 'unknown',
        retryable: false,
      });
      expect(byCall.get('pure-failure-call')).toMatchObject({
        status: 'failed',
        effectOutcome: 'not_applied',
        retryable: false,
      });
      expect(byCall.get('structured-failure-call')).toMatchObject({
        status: 'failed',
        effectOutcome: 'not_applied',
        retryable: true,
        attempts: [{ errorCode: 'UPSTREAM_REJECTED_BEFORE_WRITE' }],
      });
      expect(JSON.stringify({ events, result, page })).not.toContain(
        'secret-canary',
      );
    } finally {
      await harness.dispose();
    }
  });

  it('enforces a tool deadline through the injected timer', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'timeout-call',
          name: 'timeout-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('timeout handled'),
      ],
    });
    let fireDeadline: (() => void) | undefined;
    let observedAbort = false;
    const timeoutTool: AgentTool = {
      definition: {
        name: 'timeout-tool',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 25,
      },
      execute: async (_arguments, context) => {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(new Error('deadline reached'));
            },
            { once: true },
          );
          queueMicrotask(() => {
            if (fireDeadline) fireDeadline();
            else reject(new Error('deadline timer was not scheduled'));
          });
        });
        return { content: [] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [timeoutTool],
      timer: {
        schedule(delayMs, callback) {
          expect(delayMs).toBe(25);
          fireDeadline = callback;
          return () => {
            if (fireDeadline === callback) fireDeadline = undefined;
          };
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'time out the tool',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const page = await harness.readToolExecutions({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(observedAbort).toBe(true);
      expect(page.executions[0]).toMatchObject({
        status: 'timed_out',
        effectOutcome: 'not_applied',
        retryable: false,
        deadline: '2026-08-01T00:00:00.025Z',
        attempts: [{ status: 'timed_out' }],
      });
    } finally {
      await harness.dispose();
    }
  });

  it('propagates Task cancellation and keeps an external effect uncertain', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'cancelled-external-call',
          name: 'cancelled-external-tool',
          rawArguments: '{}',
        }),
      ],
    });
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const tool: AgentTool = {
      definition: {
        name: 'cancelled-external-tool',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async (_arguments, context) => {
        signalStarted?.();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new Error('external tool cancelled')),
            { once: true },
          );
        });
        return { content: [] };
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [tool],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'cancel external tool',
      });
      const eventPromise = collect(handle.events);
      await started;
      handle.cancel('user cancelled');
      const [, result] = await Promise.all([eventPromise, handle.result()]);
      const page = await harness.readToolExecutions({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(result).toMatchObject({ status: 'cancelled' });
      expect(page.executions[0]).toMatchObject({
        status: 'unknown',
        effectOutcome: 'unknown',
        retryable: false,
        attemptCount: 1,
      });
    } finally {
      await harness.dispose();
    }
  });

  it('checkpoints each assistant response and tool result in a two-Turn tool loop', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'lookup-checkpoint-1',
          name: 'lookup-checkpoint',
          rawArguments: '{}',
        }),
        fauxTextResponse('checkpoint complete'),
      ],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    const lookup: AgentTool = {
      definition: {
        name: 'lookup-checkpoint',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({
        content: [{ type: 'text', text: 'durable tool result' }],
      }),
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [lookup],
      runtimeStore,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'checkpoint the tool loop',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const checkpoints = await runtimeStore.readCheckpoints({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(checkpoints.map((checkpoint) => checkpoint.kind)).toEqual([
        'input_accepted',
        'model_completed',
        'tool_result_appended',
        'model_completed',
        'run_terminal',
      ]);
      expect(
        checkpoints.map((checkpoint) => checkpoint.executionPosition),
      ).toEqual(['model', 'tool', 'model', 'terminal', 'terminal']);
      expect(checkpoints.map((checkpoint) => checkpoint.resumeState)).toEqual([
        { kind: 'model', nextTurnIndex: 1 },
        { kind: 'tool', turnIndex: 1, nextProposalSequence: 1 },
        { kind: 'model', nextTurnIndex: 2 },
        expect.objectContaining({ kind: 'finalize' }),
        expect.objectContaining({ kind: 'finalize' }),
      ]);
      expect(
        checkpoints.every(
          (checkpoint) => checkpoint.checkpointSchemaVersion === 3,
        ),
      ).toBe(true);
      expect(checkpoints[1]?.transcript).toHaveLength(2);
      expect(checkpoints[2]?.transcript).toMatchObject([
        { role: 'user' },
        { role: 'assistant' },
        {
          role: 'tool_result',
          toolCallId: 'lookup-checkpoint-1',
          content: [{ type: 'text', text: 'durable tool result' }],
        },
      ]);
      expect(
        checkpoints.every((checkpoint) => checkpoint.configFingerprint),
      ).toBe(true);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('isolates concurrent task transcript, sequence, and cancellation by scope', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('first response', { paceMs: 20 }),
        fauxTextResponse('second response', { paceMs: 20 }),
      ],
    });
    const counters = new Map<string, number>();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      ids: {
        next(kind) {
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const first = await harness.startTask({
        scope: {
          tenantId: 'tenant-1',
          projectId: 'project-1',
          sessionId: 'session-1',
        },
        input: 'first input',
      });
      const second = await harness.startTask({
        scope: {
          tenantId: 'tenant-1',
          projectId: 'project-2',
          sessionId: 'session-2',
        },
        input: 'second input',
      });
      first.cancel('cancel only first');

      const [firstEvents, secondEvents, firstResult, secondResult] =
        await Promise.all([
          collect(first.events),
          collect(second.events),
          first.result(),
          second.result(),
        ]);
      const firstTask = await harness.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: first.taskId,
      });
      const secondTask = await harness.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-2',
        taskId: second.taskId,
      });

      expect(firstResult.status).toBe('cancelled');
      expect(secondResult.status).toBe('completed');
      expect(firstTask).toMatchObject({
        status: 'cancelled',
        runs: [{ status: 'cancelled', turns: [{ status: 'cancelled' }] }],
      });
      expect(firstTask?.transcript).toMatchObject([
        { role: 'user', content: [{ type: 'text', text: 'first input' }] },
        { role: 'assistant', status: 'cancelled' },
      ]);
      expect(secondTask?.transcript).toMatchObject([
        { role: 'user', content: [{ type: 'text', text: 'second input' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: expect.stringMatching(/response/) }],
        },
      ]);
      expect(JSON.stringify(firstTask?.transcript)).not.toContain(
        'second input',
      );
      expect(JSON.stringify(firstTask?.transcript)).not.toContain(
        'second response',
      );
      expect(firstEvents[0]).toMatchObject({ sequence: 1, taskId: 'task-1' });
      expect(secondEvents[0]).toMatchObject({ sequence: 1, taskId: 'task-2' });
      expect(
        firstEvents.every(
          (event) =>
            event.projectId === 'project-1' && event.sessionId === 'session-1',
        ),
      ).toBe(true);
      expect(
        secondEvents.every(
          (event) =>
            event.projectId === 'project-2' && event.sessionId === 'session-2',
        ),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('does not reveal a Task through lookup or cancellation from another scope', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('done')],
    });
    const counters = new Map<string, number>();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      ids: {
        next(kind) {
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'hello',
      });
      await Promise.all([collect(handle.events), handle.result()]);

      await expect(
        harness.getTask({
          tenantId: 'tenant-1',
          projectId: 'project-2',
          taskId: handle.taskId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        harness.cancelTask({
          tenantId: 'tenant-1',
          projectId: 'project-2',
          taskId: handle.taskId,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_TASK_NOT_FOUND' });
      await expect(
        harness.cancelTask({
          tenantId: 'tenant-1',
          projectId: 'project-2',
          taskId: 'never-existed',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_TASK_NOT_FOUND' });
    } finally {
      await harness.dispose();
    }
  });

  it('marks the active Turn, Run, and Task failed after a terminal model failure', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxFailure({
          error: new AiRuntimeError(
            'FAUX_MODEL_FAILED',
            'provider',
            'model failed',
            false,
          ),
        }),
      ],
    });
    const counters = new Map<string, number>();
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      ids: {
        next(kind) {
          const value = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, value);
          return `${kind}-${value}`;
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'fail',
      });
      const events = await collect(handle.events);
      const result = await handle.result();
      const task = await harness.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
      });

      expect(result.status).toBe('failed');
      expect(task).toMatchObject({
        status: 'failed',
        runs: [
          {
            status: 'failed',
            turns: [{ turnIndex: 1, status: 'failed' }],
          },
        ],
      });
      expect(
        events.filter((event) => event.payload.type === 'run_end'),
      ).toHaveLength(1);
      expect(events.at(-1)?.payload.type).toBe('run_end');
    } finally {
      await harness.dispose();
    }
  });

  it('fails the Task at max turns while preserving the completed Turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'again-1',
          name: 'again',
          rawArguments: '{}',
        }),
      ],
    });
    const again: AgentTool = {
      definition: {
        name: 'again',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({ content: [{ type: 'text', text: 'again' }] }),
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [again],
      maxTurns: 1,
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'loop',
      });
      await collect(handle.events);
      const result = await handle.result();

      expect(result).toMatchObject({
        status: 'failed',
        execution: {
          error: { code: 'AGENT_MAX_TURNS' },
        },
        task: {
          status: 'failed',
          runs: [{ status: 'failed', turns: [{ status: 'completed' }] }],
        },
      });
    } finally {
      await harness.dispose();
    }
  });

  it('bounds an unconsumed Harness event stream and preserves one terminal event', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('overflow')],
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      eventBuffer: { maxEvents: 1 },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'do not consume yet',
      });
      const result = await handle.result();
      const events = await collect(handle.events);

      expect(result).toMatchObject({
        status: 'failed',
        execution: {
          status: 'failed',
          error: { code: 'AGENT_EVENT_BUFFER_OVERFLOW' },
        },
        task: { status: 'failed', runs: [{ status: 'failed' }] },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        payload: {
          type: 'run_end',
          result: {
            status: 'failed',
            error: { code: 'AGENT_EVENT_BUFFER_OVERFLOW' },
          },
        },
      });
    } finally {
      await harness.dispose();
    }
  });

  it('commits streaming deltas in bounded durable micro-batches', async () => {
    const fixture = createFauxProvider({
      initialResponses: [manyTextDeltas(40)],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const deltaBatchSizes: number[] = [];
    const runtimeStore = forwardRuntimeStore(baseStore, {
      commitTask: async (command) => {
        if (
          command.events?.every((event) => event.payload.type === 'text_delta')
        )
          deltaBatchSizes.push(command.events.length);
        return baseStore.commitTask(command);
      },
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      durableEventBatch: { maxEvents: 32, maxWaitMs: 25 },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'batch the response',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);

      expect(result.status).toBe('completed');
      expect(deltaBatchSizes).toEqual([32, 8]);
      expect(
        events.filter((event) => event.payload.type === 'text_delta'),
      ).toHaveLength(40);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('detaches an overflowing durable observer without cancelling the Task', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('durable observer result')],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const runtimeStore = forwardRuntimeStore(baseStore, {
      durability: 'durable',
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      eventBuffer: { maxEvents: 1 },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'overflow only the live observer',
      });
      await expect(handle.result()).resolves.toMatchObject({
        status: 'completed',
        task: { status: 'completed' },
      });
      await expect(collect(handle.events)).rejects.toMatchObject({
        code: 'AGENT_OBSERVER_OVERFLOW',
      });
      await expect(
        harness.readEvents({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: handle.taskId,
          runId: handle.runId,
        }),
      ).resolves.toMatchObject({
        hasMore: false,
        events: [
          { sequence: 1, payload: { type: 'run_start' } },
          { sequence: 2, payload: { type: 'turn_start' } },
          { sequence: 3, payload: { type: 'model_start' } },
          { sequence: 4, payload: { type: 'text_delta' } },
          { sequence: 5, payload: { type: 'model_end' } },
          { sequence: 6, payload: { type: 'turn_end' } },
          { sequence: 7, payload: { type: 'run_end' } },
        ],
      });
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('acquires the initial durable Run lease before returning the Task handle', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('owned durably', { paceMs: 20 })],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const runtimeStore = forwardRuntimeStore(baseStore, {
      durability: 'durable',
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-lease', projectId: 'project-lease' },
        input: 'own this Run before execution',
      });
      const query = {
        tenantId: 'tenant-lease',
        projectId: 'project-lease',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [audit, checkpoint] = await Promise.all([
        runtimeStore.readRunRecoveryAudit(query),
        runtimeStore.getCheckpoint(query),
      ]);

      expect(audit).toMatchObject([
        {
          sequence: 1,
          action: 'initial_claim',
          fencingToken: 1,
          ownerId: expect.any(String),
        },
      ]);
      expect(JSON.stringify(audit)).not.toContain('leaseToken');
      await expect(
        runtimeStore.claimRecoverableRuns({
          claimId: 'competing-initial-claim',
          ownerId: 'competing-worker',
          configFingerprint: checkpoint!.configFingerprint,
          limit: 1,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:00:31.000Z',
        }),
      ).resolves.toEqual({ leases: [] });

      await Promise.all([collect(handle.events), handle.result()]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('keeps ephemeral Harness execution lease-free', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('ephemeral stays compatible')],
    });
    const runtimeStore = createInMemoryAgentRuntimeStore();
    let heartbeatSchedules = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      timer: {
        schedule(delayMs, callback) {
          if (delayMs === 10_000) heartbeatSchedules += 1;
          const timeout = setTimeout(callback, delayMs);
          return () => clearTimeout(timeout);
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-lease', projectId: 'project-ephemeral' },
        input: 'stay lease-free',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      await expect(
        runtimeStore.readRunRecoveryAudit({
          tenantId: 'tenant-lease',
          projectId: 'project-ephemeral',
          taskId: handle.taskId,
          runId: handle.runId,
        }),
      ).resolves.toEqual([]);
      expect(heartbeatSchedules).toBe(0);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('renews the durable Run lease without recovery audit noise', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('heartbeat kept ownership', { paceMs: 30 }),
      ],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    let observeRenewal: (() => void) | undefined;
    const renewalObserved = new Promise<void>((resolve) => {
      observeRenewal = resolve;
    });
    const renewalCommands: Parameters<AgentRuntimeStore['renewRunLease']>[0][] =
      [];
    const runtimeStore = forwardRuntimeStore(baseStore, {
      durability: 'durable',
      renewRunLease: async (command) => {
        renewalCommands.push(command);
        const lease = await baseStore.renewRunLease(command);
        observeRenewal?.();
        return lease;
      },
    });
    let now = '2026-08-01T00:00:00.000Z';
    let heartbeat: (() => void) | undefined;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      clock: { now: () => now },
      runLease: { durationMs: 6_000, heartbeatIntervalMs: 2_000 },
      timer: {
        schedule(delayMs, callback) {
          if (delayMs === 2_000) heartbeat = callback;
          return () => {
            if (heartbeat === callback) heartbeat = undefined;
          };
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-lease', projectId: 'project-heartbeat' },
        input: 'keep this Run owned',
      });
      const query = {
        tenantId: 'tenant-lease',
        projectId: 'project-heartbeat',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      expect(heartbeat).toEqual(expect.any(Function));

      now = '2026-08-01T00:00:02.000Z';
      heartbeat!();
      await renewalObserved;

      expect(renewalCommands).toMatchObject([
        {
          ...query,
          ownerId: expect.any(String),
          renewalId: expect.any(String),
          fencingToken: 1,
          now: '2026-08-01T00:00:02.000Z',
          leaseExpiresAt: '2026-08-01T00:00:08.000Z',
        },
      ]);
      await expect(
        runtimeStore.readRunRecoveryAudit(query),
      ).resolves.toMatchObject([
        { sequence: 1, action: 'initial_claim', fencingToken: 1 },
      ]);
      const checkpoint = await runtimeStore.getCheckpoint(query);
      await expect(
        runtimeStore.claimRecoverableRuns({
          claimId: 'claim-at-original-expiry',
          ownerId: 'competing-worker',
          configFingerprint: checkpoint!.configFingerprint,
          limit: 1,
          now: '2026-08-01T00:00:06.000Z',
          leaseExpiresAt: '2026-08-01T00:00:36.000Z',
        }),
      ).resolves.toEqual({ leases: [] });

      await Promise.all([collect(handle.events), handle.result()]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('stops local execution on lease loss without fabricating a terminal state', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('old owner must not commit this', { paceMs: 100 }),
      ],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const runtimeStore = forwardRuntimeStore(baseStore, {
      durability: 'durable',
    });
    let now = '2026-08-01T00:00:00.000Z';
    let heartbeat: (() => void) | undefined;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      clock: { now: () => now },
      timer: {
        schedule(delayMs, callback) {
          if (delayMs === 10_000) heartbeat = callback;
          return () => {
            if (heartbeat === callback) heartbeat = undefined;
          };
        },
      },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-lease', projectId: 'project-loss' },
        input: 'lose ownership while the model is active',
      });
      const query = {
        tenantId: 'tenant-lease',
        projectId: 'project-loss',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const checkpoint = await runtimeStore.getCheckpoint(query);
      const eventFailure = collect(handle.events).catch(
        (error: unknown) => error,
      );

      now = '2026-08-01T00:00:30.000Z';
      const takeover = await runtimeStore.claimRecoverableRuns({
        claimId: 'claim-after-owner-expired',
        ownerId: 'replacement-worker',
        configFingerprint: checkpoint!.configFingerprint,
        limit: 1,
        now,
        leaseExpiresAt: '2026-08-01T00:01:00.000Z',
      });
      expect(takeover.leases).toMatchObject([
        { ...query, ownerId: 'replacement-worker', fencingToken: 2 },
      ]);

      heartbeat!();
      await expect(handle.result()).rejects.toMatchObject({
        code: 'AGENT_EXECUTION_OWNERSHIP_LOST',
        message: 'Agent Run execution ownership was lost',
      });
      await expect(eventFailure).resolves.toMatchObject({
        code: 'AGENT_EXECUTION_OWNERSHIP_LOST',
      });
      await expect(runtimeStore.getTask(query)).resolves.toMatchObject({
        status: 'running',
        runs: [{ status: 'running' }],
      });
      const replay = await runtimeStore.readEvents({
        ...query,
        afterSequence: 0,
        limit: 100,
      });
      expect(
        replay.events.some((event) => event.payload.type === 'run_end'),
      ).toBe(false);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('reconciles an unknown commit result without duplicating durable events', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('reconciled commit')],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    let responseLost = false;
    const runtimeStore = forwardRuntimeStore(baseStore, {
      commitTask: async (command) => {
        const receipt = await baseStore.commitTask(command);
        if (
          !responseLost &&
          command.events?.some((event) => event.payload.type === 'model_end')
        ) {
          responseLost = true;
          throw new Error('simulated connection loss after COMMIT');
        }
        return receipt;
      },
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'reconcile the commit',
      });
      const [events, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);

      expect(responseLost).toBe(true);
      expect(result.status).toBe('completed');
      expect(events.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      const replay = await runtimeStore.readEvents({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        afterSequence: 0,
        limit: 100,
      });
      expect(replay.events.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('reconciles an unknown Approval decision with the exact original command', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-reconcile-call',
          name: 'approval-reconcile-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('reconciled Approval decision'),
      ],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const decisionCommands: Parameters<
      AgentRuntimeStore['decideApproval']
    >[0][] = [];
    let responseLost = false;
    const runtimeStore = forwardRuntimeStore(baseStore, {
      decideApproval: async (command) => {
        decisionCommands.push(command);
        const receipt = await baseStore.decideApproval(command);
        if (!responseLost) {
          responseLost = true;
          throw new Error('simulated connection loss after Approval COMMIT');
        }
        return receipt;
      },
    });
    let invocationCount = 0;
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
      tools: [
        {
          definition: {
            name: 'approval-reconcile-tool',
            inputSchema: { type: 'object', additionalProperties: false },
          },
          execution: {
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
          execute: async () => {
            invocationCount += 1;
            return { content: [{ type: 'text', text: 'approved once' }] };
          },
        },
      ],
      approvalPolicy: {
        policyId: 'approval-reconcile-policy',
        version: 'v1',
        evaluate: () => ({
          decision: 'require_approval',
          expiresAt: '2026-08-01T01:00:00.000Z',
          presentation: { title: 'Reconcile Approval' },
        }),
      },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'reconcile an unknown Approval decision',
      });
      const waiting = await waitForApprovalRequest(handle);
      const decision = await harness.decideApproval({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: waiting.approvalId,
        decisionId: 'approval-reconcile-decision',
        decision: 'approved',
        decidedBy: 'reviewer-1',
      });
      const [result] = await Promise.all([
        handle.result(),
        collectIterator(waiting.iterator),
      ]);
      const approvals = await runtimeStore.readApprovals({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(responseLost).toBe(true);
      expect(decision).toMatchObject({
        status: 'approved',
        decisionId: 'approval-reconcile-decision',
      });
      expect(decisionCommands).toHaveLength(2);
      expect(decisionCommands[1]).toEqual(decisionCommands[0]);
      expect(result.status).toBe('completed');
      expect(invocationCount).toBe(1);
      expect(approvals).toMatchObject([
        {
          status: 'approved',
          decisionId: 'approval-reconcile-decision',
          transitions: [
            { sequence: 1, to: 'pending' },
            { sequence: 2, to: 'approved' },
            { sequence: 3, to: 'approved', consumeId: expect.any(String) },
          ],
        },
      ]);
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('rejects on unrecoverable durability loss without fabricating terminal state', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('must not become terminal')],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const runtimeStore = forwardRuntimeStore(baseStore, {
      commitTask: async (command) => {
        if (
          command.events?.some((event) => event.payload.type === 'model_start')
        )
          throw new Error('private database host and password');
        return baseStore.commitTask(command);
      },
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'lose durable storage',
      });
      const eventFailure = collect(handle.events).catch(
        (error: unknown) => error,
      );

      await expect(handle.result()).rejects.toMatchObject({
        code: 'AGENT_DURABILITY_FAILED',
        message: 'Agent durable state is unavailable',
      });
      await expect(eventFailure).resolves.toMatchObject({
        code: 'AGENT_DURABILITY_FAILED',
      });
      const task = await runtimeStore.getTask({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
      });
      const replay = await runtimeStore.readEvents({
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: handle.taskId,
        runId: handle.runId,
        afterSequence: 0,
        limit: 100,
      });

      expect(task).toMatchObject({ status: 'running' });
      expect(replay.events.map((event) => event.payload.type)).toEqual([
        'run_start',
        'turn_start',
      ]);
      expect(JSON.stringify(await eventFailure)).not.toContain(
        'private database host and password',
      );
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('sanitizes an initial durable acceptance failure', async () => {
    const fixture = createFauxProvider();
    const baseStore = createInMemoryAgentRuntimeStore();
    const runtimeStore = forwardRuntimeStore(baseStore, {
      createTask: async () => {
        throw new Error('private initial database failure');
      },
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore,
    });

    try {
      await expect(
        harness.startTask({
          scope: { tenantId: 'tenant-1', projectId: 'project-1' },
          input: 'cannot accept',
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_DURABILITY_FAILED',
        message: 'Agent durable state is unavailable',
      });
    } finally {
      await harness.dispose();
      await runtimeStore.dispose();
    }
  });

  it('disposes once, cancels active work, and rejects new tasks', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 20 })],
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });
    const handle = await harness.startTask({
      scope: { tenantId: 'tenant-1', projectId: 'project-1' },
      input: 'wait',
    });
    const eventsPromise = collect(handle.events);

    const firstDispose = harness.dispose();
    const secondDispose = harness.dispose();
    expect(secondDispose).toBe(firstDispose);
    await firstDispose;

    const [result, events] = await Promise.all([
      handle.result(),
      eventsPromise,
    ]);
    expect(result).toMatchObject({
      status: 'cancelled',
      task: {
        status: 'cancelled',
        runs: [{ status: 'cancelled', turns: [{ status: 'cancelled' }] }],
      },
    });
    expect(events.at(-1)?.payload.type).toBe('run_end');
    await expect(
      harness.startTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        input: 'later',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_DISPOSED' });
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

async function collectIterator<T>(iterator: AsyncIterator<T>): Promise<T[]> {
  const values: T[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) return values;
    values.push(next.value);
  }
}

async function waitForApprovalRequest(handle: AgentTaskHandle): Promise<{
  approvalId: string;
  events: import('../index.js').AgentHarnessEvent[];
  iterator: AsyncIterator<import('../index.js').AgentHarnessEvent>;
}> {
  const iterator = handle.events[Symbol.asyncIterator]();
  const events: import('../index.js').AgentHarnessEvent[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error('Agent event stream ended before Approval');
    events.push(next.value);
    if (next.value.payload.type === 'approval_requested')
      return {
        approvalId: next.value.payload.approvalId,
        events,
        iterator,
      };
  }
}

async function waitForNextApprovalRequest(
  iterator: AsyncIterator<import('../index.js').AgentHarnessEvent>,
  observedEvents: import('../index.js').AgentHarnessEvent[],
): Promise<{ approvalId: string }> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error('Agent event stream ended before Approval');
    observedEvents.push(next.value);
    if (next.value.payload.type === 'approval_requested')
      return { approvalId: next.value.payload.approvalId };
  }
}

function approvalTerminalTool(onExecute: () => void): AgentTool {
  return {
    definition: {
      name: 'approval-terminal-tool',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    execution: {
      sideEffect: 'external',
      idempotency: 'none',
      timeoutMs: 30_000,
    },
    execute: async () => {
      onExecute();
      return { content: [{ type: 'text', text: 'must not execute' }] };
    },
  };
}

function requireTestApproval(expiresAt: string) {
  return {
    policyId: 'terminal-test-policy',
    version: 'v1',
    evaluate: () => ({
      decision: 'require_approval' as const,
      expiresAt,
      presentation: { title: 'Confirm action' },
    }),
  };
}

function manyTextDeltas(count: number): FauxResponseScript {
  return {
    chunks: [
      {
        event: { type: 'text_start', itemId: 'text-many', contentIndex: 0 },
      },
      ...Array.from({ length: count }, (_, index) => ({
        event: {
          type: 'text_delta' as const,
          itemId: 'text-many',
          contentIndex: 0,
          delta: String(index % 10),
        },
      })),
      {
        event: { type: 'text_end', itemId: 'text-many', contentIndex: 0 },
      },
    ],
    terminal: {
      status: 'completed',
      finishReason: 'stop',
      responseId: 'many-text-deltas',
    },
  };
}

function forwardRuntimeStore(
  base: AgentRuntimeStore,
  overrides: Partial<AgentRuntimeStore>,
): AgentRuntimeStore {
  return {
    durability: overrides.durability ?? base.durability,
    runLeaseSupport: overrides.runLeaseSupport ?? base.runLeaseSupport,
    checkpointResumeSupport:
      overrides.checkpointResumeSupport ?? base.checkpointResumeSupport,
    reconciliationSupport:
      overrides.reconciliationSupport ?? base.reconciliationSupport,
    createTask: overrides.createTask ?? ((command) => base.createTask(command)),
    commitTask: overrides.commitTask ?? ((command) => base.commitTask(command)),
    claimRecoverableRuns:
      overrides.claimRecoverableRuns ??
      ((command) => base.claimRecoverableRuns(command)),
    renewRunLease:
      overrides.renewRunLease ?? ((command) => base.renewRunLease(command)),
    releaseRunLease:
      overrides.releaseRunLease ?? ((command) => base.releaseRunLease(command)),
    readRunRecoveryAudit:
      overrides.readRunRecoveryAudit ??
      ((query) => base.readRunRecoveryAudit(query)),
    readRecoverySnapshot:
      overrides.readRecoverySnapshot ??
      ((command) => base.readRecoverySnapshot(command)),
    getTask: overrides.getTask ?? ((query) => base.getTask(query)),
    getCheckpoint:
      overrides.getCheckpoint ?? ((query) => base.getCheckpoint(query)),
    readCheckpoints:
      overrides.readCheckpoints ?? ((query) => base.readCheckpoints(query)),
    readEvents: overrides.readEvents ?? ((query) => base.readEvents(query)),
    readToolExecutions:
      overrides.readToolExecutions ??
      ((query) => base.readToolExecutions(query)),
    readApprovals:
      overrides.readApprovals ?? ((query) => base.readApprovals(query)),
    readReconciliationCases:
      overrides.readReconciliationCases ??
      ((query) => base.readReconciliationCases(query)),
    decideApproval:
      overrides.decideApproval ?? ((command) => base.decideApproval(command)),
    resolveApproval:
      overrides.resolveApproval ?? ((command) => base.resolveApproval(command)),
    claimOutbox:
      overrides.claimOutbox ?? ((command) => base.claimOutbox(command)),
    acknowledgeOutbox:
      overrides.acknowledgeOutbox ??
      ((command) => base.acknowledgeOutbox(command)),
    releaseOutbox:
      overrides.releaseOutbox ?? ((command) => base.releaseOutbox(command)),
    dispose: overrides.dispose ?? (() => base.dispose()),
  };
}
