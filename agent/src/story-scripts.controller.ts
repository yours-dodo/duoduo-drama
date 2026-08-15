import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';

import { StoryScriptsService } from './story-scripts.service.js';
import { StoryScriptWorkflowError } from './workflows/story-script/story-script.workflow.js';

interface GenerateStoryScriptBody {
  requestId?: string;
  userPrompt?: unknown;
  previousArtifacts?: unknown;
  history?: unknown;
}

@Controller('v1/story-scripts')
export class StoryScriptsController {
  constructor(
    @Inject(StoryScriptsService) private readonly service: StoryScriptsService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateStoryScriptBody) {
    if (typeof body.userPrompt !== 'string') {
      throw new HttpException(
        { error: { code: 'protocol_error', message: 'userPrompt is required' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      return await this.service.generate({
        requestId:
          typeof body.requestId === 'string' ? body.requestId : undefined,
        userPrompt: body.userPrompt,
        previousArtifacts:
          typeof body.previousArtifacts === 'string'
            ? body.previousArtifacts
            : undefined,
        history: typeof body.history === 'string' ? body.history : undefined,
      });
    } catch (error) {
      if (error instanceof StoryScriptWorkflowError) {
        const status =
          error.failureCode === 'timeout'
            ? HttpStatus.GATEWAY_TIMEOUT
            : error.failureCode === 'agent_unavailable'
              ? HttpStatus.BAD_GATEWAY
              : HttpStatus.UNPROCESSABLE_ENTITY;
        throw new HttpException(
          { error: { code: error.failureCode, message: error.message } },
          status,
        );
      }
      throw error;
    }
  }
}
