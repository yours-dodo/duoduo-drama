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
import { StoryTagsWorkflowError } from './workflows/story-tags/story-tags.workflow.js';

interface GenerateStoryTagsBody {
  title?: unknown;
  description?: unknown;
}

@Controller('v1/story-tags')
export class StoryTagsController {
  constructor(
    @Inject(StoryScriptsService) private readonly service: StoryScriptsService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateStoryTagsBody) {
    if (
      typeof body.title !== 'string' ||
      typeof body.description !== 'string'
    ) {
      throw new HttpException(
        {
          error: {
            code: 'protocol_error',
            message: 'title and description are required',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      return await this.service.summarizeTags({
        title: body.title,
        description: body.description,
      });
    } catch (error) {
      if (error instanceof StoryTagsWorkflowError) {
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
