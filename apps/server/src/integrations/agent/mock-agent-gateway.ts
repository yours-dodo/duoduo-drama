import { AgentGatewayError } from './agent-gateway.js';
import type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
} from './agent-contracts.js';

export class MockAgentGateway implements AgentGateway {
  constructor(
    private readonly options: {
      failureCode?: 'agent_unavailable' | 'timeout' | 'protocol_error';
    } = {},
  ) {}

  async generateStory(
    request: StoryGenerationAgentRequest,
  ): Promise<StoryGenerationAgentResult> {
    if (this.options.failureCode) {
      throw new AgentGatewayError(this.options.failureCode);
    }

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
}
