import { AgentGatewayError } from './agent-gateway.js';
import type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
  StoryGenerationFailureCode,
  StoryTaskRef,
  StoryTaskSnapshot,
  StoryTagGenerationResult,
} from './agent-contracts.js';

interface MockTask {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: 'queued' | 'script' | 'images' | 'speech' | 'video';
  error?: string;
  result?: StoryGenerationAgentResult;
}

export class MockAgentGateway implements AgentGateway {
  private readonly tasks = new Map<string, MockTask>();

  constructor(
    private readonly options: {
      failureCode?: StoryGenerationFailureCode;
    } = {},
  ) {}

  async startStory(
    request: StoryGenerationAgentRequest,
  ): Promise<StoryTaskRef> {
    const taskId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: MockTask = {
      taskId,
      status: 'running',
      stage: 'video',
    };
    this.tasks.set(taskId, {
      ...task,
      status: this.options.failureCode ? 'failed' : 'succeeded',
      ...(this.options.failureCode
        ? { error: this.options.failureCode }
        : { result: mockResult(request) }),
    });
    return { taskId, status: task.status, stage: task.stage };
  }

  async getStoryTask(taskId: string): Promise<StoryTaskSnapshot> {
    const task = this.tasks.get(taskId);
    if (!task) throw new AgentGatewayError('protocol_error');
    if (task.status === 'failed') {
      return {
        taskId: task.taskId,
        status: task.status,
        stage: task.stage,
        error: task.error,
        failureCode: this.options.failureCode ?? 'agent_unavailable',
      };
    }
    if (task.status === 'succeeded' && task.result) {
      return {
        taskId: task.taskId,
        status: task.status,
        stage: task.stage,
        result: task.result,
      };
    }
    return { taskId: task.taskId, status: task.status, stage: task.stage };
  }

  async summarizeStoryTags(): Promise<StoryTagGenerationResult> {
    if (this.options.failureCode) {
      throw new AgentGatewayError(this.options.failureCode);
    }
    return { era: '现代', tags: ['悬疑', '情感'] };
  }
}

function mockResult(
  request: StoryGenerationAgentRequest,
): StoryGenerationAgentResult {
  const prompt = request.userPrompt.trim();
  const title = `故事大纲：${prompt}`;
  const content = [
    '# 故事大纲',
    '',
    `创作目标：${prompt}`,
    '',
    '## 核心冲突',
    '',
    '待根据人物关系和故事目标继续展开。',
  ].join('\n');
  return {
    artifactType: 'outline',
    title,
    content,
    contentFormat: 'markdown',
    assistantBody: `已根据「${prompt}」生成故事草稿：${title}`,
  };
}
