import { AgentGatewayError } from './agent-gateway.js';
import type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
  StoryGenerationFailureCode,
  StoryTaskRef,
  StoryTaskSnapshot,
} from './agent-contracts.js';

interface AgentTaskResult {
  script: unknown;
  images: ReadonlyArray<unknown>;
  audio: ReadonlyArray<unknown>;
  video?: unknown;
}

interface AgentTaskResponse {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: 'queued' | 'script' | 'images' | 'speech' | 'video';
  result?: AgentTaskResult;
  error?: string;
}

interface AgentErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Real gateway to the Agent service's linear story-script workflow.
 * Replaces MockAgentGateway for story generation; it persists the structured
 * script inside the `story` module as JSON and returns a human summary as the
 * assistant message.
 */
export class HttpAgentGateway implements AgentGateway {
  constructor(
    private readonly agentServiceUrl: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async startStory(
    request: StoryGenerationAgentRequest,
  ): Promise<StoryTaskRef> {
    const payload = await this.postJson<AgentTaskResponse>(
      '/v1/story-tasks',
      {
        requestId: request.requestId,
        userPrompt: request.userPrompt,
        previousArtifacts: formatArtifacts(request),
        history: formatHistory(request),
      },
    );
    if (!payload.taskId || !payload.status || !payload.stage) {
      throw new AgentGatewayError('protocol_error');
    }
    return { taskId: payload.taskId, status: payload.status, stage: payload.stage };
  }

  async getStoryTask(taskId: string): Promise<StoryTaskSnapshot> {
    const payload = await this.getJson<AgentTaskResponse>(
      `/v1/story-tasks/${encodeURIComponent(taskId)}`,
    );
    if (!payload.taskId || !payload.status || !payload.stage) {
      throw new AgentGatewayError('protocol_error');
    }
    if (payload.status === 'failed') {
      return {
        taskId: payload.taskId,
        status: payload.status,
        stage: payload.stage,
        error: payload.error,
        failureCode: inferFailureCode(payload.error),
      };
    }
    if (payload.status === 'succeeded') {
      if (!payload.result?.script) {
        throw new AgentGatewayError('protocol_error');
      }
      return {
        taskId: payload.taskId,
        status: payload.status,
        stage: payload.stage,
        result: assembleResult(payload.result),
      };
    }
    return {
      taskId: payload.taskId,
      status: payload.status,
      stage: payload.stage,
    };
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.agentServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw this.toGatewayError(response.status, await readErrorBody(response));
    }
    return (await response.json()) as T;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.agentServiceUrl}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw this.toGatewayError(response.status, await readErrorBody(response));
    }
    return (await response.json()) as T;
  }

  private toGatewayError(
    status: number,
    body: AgentErrorBody,
  ): AgentGatewayError {
    if (status === 504 || status === 408) return new AgentGatewayError('timeout');
    if (status >= 500) return new AgentGatewayError('agent_unavailable');
    const code = body?.error?.code;
    if (code === 'timeout') return new AgentGatewayError('timeout');
    if (code === 'agent_unavailable') {
      return new AgentGatewayError('agent_unavailable');
    }
    return new AgentGatewayError('protocol_error');
  }
}

function inferFailureCode(error: string | undefined): StoryGenerationFailureCode {
  if (error?.toLowerCase().includes('timeout')) return 'timeout';
  return 'agent_unavailable';
}

function assembleResult(result: AgentTaskResult): StoryGenerationAgentResult {
  const images = result.images ?? [];
  const audio = result.audio ?? [];
  const video = result.video as
    | { durationSeconds?: number }
    | undefined;
  const content = JSON.stringify({
    script: result.script,
    images,
    audio,
    ...(video ? { video } : {}),
  });
  const script = result.script as { title?: string } | undefined;
  return {
    artifactType: 'story',
    title: script?.title ?? '未命名故事',
    content,
    contentFormat: 'json',
    assistantBody:
      `已生成完整短剧《${script?.title ?? ''}》` +
      `：${images.length} 张场景配图、${audio.length} 段对白配音` +
      (video?.durationSeconds
        ? `、合成 ${Math.round(video.durationSeconds)}s 短视频`
        : '') +
      '。',
  };
}

async function readErrorBody(response: Response): Promise<AgentErrorBody> {
  try {
    return (await response.json()) as AgentErrorBody;
  } catch {
    return {};
  }
}

function formatArtifacts(request: StoryGenerationAgentRequest): string {
  const sections = request.artifacts.map(
    (artifact) =>
      `## ${artifact.title}（${artifact.type}）\n${artifact.content}`,
  );
  return sections.join('\n\n');
}

function formatHistory(request: StoryGenerationAgentRequest): string {
  const lines = request.messages.map((message) => {
    const prefix =
      message.authorType === 'user' ? '用户' : message.authorType === 'agent' ? '助手' : '系统';
    return `${prefix}：${message.body}`;
  });
  return lines.join('\n');
}
