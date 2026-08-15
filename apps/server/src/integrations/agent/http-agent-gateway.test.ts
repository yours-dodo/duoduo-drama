import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentGatewayError } from './agent-gateway.js';
import { HttpAgentGateway } from './http-agent-gateway.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('HttpAgentGateway', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it('starts a story task and maps its status', async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            taskId: 'task-1',
            status: 'running',
            stage: 'script',
            received: JSON.parse(body),
          }),
        );
      });
    });
    const gateway = new HttpAgentGateway(await listen(server));

    const task = await gateway.startStory({
      requestId: 'request-1',
      idempotencyKey: 'key-1',
      authorization: {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
      },
      userPrompt: '写一个海边悬疑故事',
      messages: [],
      artifacts: [],
    });

    expect(task).toEqual({ taskId: 'task-1', status: 'running', stage: 'script' });
  });

  it('maps a succeeded task to the json story module', async () => {
    const script = { title: '潮声之后', logline: '一句话' };
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          taskId: 'task-1',
          status: 'succeeded',
          stage: 'video',
          result: {
            script,
            images: [{ sceneId: 's1', imageUrl: 'data:image/png,x' }],
            audio: [{ shotId: 'shot-1', audioBase64: 'QUJD', mimeType: 'audio/wav' }],
            video: { outputPath: '/tmp/out.mp4', durationSeconds: 11 },
          },
        }),
      );
    });
    const gateway = new HttpAgentGateway(await listen(server));

    const snapshot = await gateway.getStoryTask('task-1');
    expect(snapshot.status).toBe('succeeded');
    const result = snapshot.result!;
    expect(result.artifactType).toBe('story');
    expect(result.contentFormat).toBe('json');
    const content = JSON.parse(result.content) as {
      script: unknown;
      images: unknown[];
      audio: unknown[];
    };
    expect(content.script).toEqual(script);
    expect(content.images).toHaveLength(1);
    expect(content.audio).toHaveLength(1);
    expect(result.assistantBody).toContain('1 张场景配图');
    expect(result.assistantBody).toContain('11s');
  });

  it('maps a failed task to a failure code', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          taskId: 'task-1',
          status: 'failed',
          stage: 'images',
          error: 'provider timeout',
        }),
      );
    });
    const gateway = new HttpAgentGateway(await listen(server));

    const snapshot = await gateway.getStoryTask('task-1');
    expect(snapshot.status).toBe('failed');
    expect(snapshot.failureCode).toBe('timeout');
  });

  it('maps a 5xx agent response to agent_unavailable', async () => {
    server = createServer((_request, response) => {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'agent_unavailable' } }));
    });
    const gateway = new HttpAgentGateway(await listen(server));

    await expect(
      gateway.startStory({
        requestId: 'request-1',
        idempotencyKey: 'key-1',
        authorization: {
          tenantId: 'tenant-1',
          projectId: 'project-1',
          conversationId: 'conversation-1',
        },
        userPrompt: '写一个故事',
        messages: [],
        artifacts: [],
      }),
    ).rejects.toBeInstanceOf(AgentGatewayError);
  });
});
