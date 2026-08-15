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

import { parseLinearScript } from './contracts/story-script.js';
import { StoryImagesService } from './story-images.service.js';
import { StoryImageWorkflowError } from './workflows/story-images/story-images.workflow.js';

interface GenerateStoryImagesBody {
  script?: unknown;
  previousImages?: unknown;
}

@Controller('v1/story-images')
export class StoryImagesController {
  constructor(
    @Inject(StoryImagesService) private readonly service: StoryImagesService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateStoryImagesBody) {
    if (!body.script || typeof body.script !== 'object') {
      throw new HttpException(
        { error: { code: 'protocol_error', message: 'script is required' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let script;
    try {
      script = parseLinearScript(JSON.stringify(body.script));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpException(
        { error: { code: 'protocol_error', message } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const previousImages = normalizePreviousImages(body.previousImages);
    try {
      return await this.service.generate({ script, previousImages });
    } catch (error) {
      if (error instanceof StoryImageWorkflowError) {
        const status =
          error.failureCode === 'agent_unavailable'
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

function normalizePreviousImages(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

