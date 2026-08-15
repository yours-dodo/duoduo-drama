import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';

import { StoryTaskService } from './story-task.service.js';

interface CreateStoryTaskBody {
  requestId?: string;
  userPrompt?: unknown;
  previousArtifacts?: unknown;
  history?: unknown;
}

@Controller('v1/story-tasks')
export class StoryTaskController {
  constructor(
    @Inject(StoryTaskService) private readonly tasks: StoryTaskService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateStoryTaskBody) {
    if (typeof body.userPrompt !== 'string') {
      throw new HttpException(
        { error: { code: 'protocol_error', message: 'userPrompt is required' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.tasks.create({
      requestId:
        typeof body.requestId === 'string' ? body.requestId : undefined,
      userPrompt: body.userPrompt,
      previousArtifacts:
        typeof body.previousArtifacts === 'string'
          ? body.previousArtifacts
          : undefined,
      history: typeof body.history === 'string' ? body.history : undefined,
    });
  }

  @Version(VERSION_NEUTRAL)
  @Get(':taskId')
  get(@Param('taskId') taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) throw new NotFoundException('story task not found');
    return task;
  }
}

