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
  StreamableFile,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { parseLinearScript } from './contracts/story-script.js';
import { STORY_VIDEO_CONFIG, type StoryVideoConfig } from './config/story-video-config.js';
import { StoryVideoService } from './story-video.service.js';
import { StoryVideoWorkflowError } from './workflows/story-video/story-video.workflow.js';

interface RenderStoryVideoBody {
  script?: unknown;
  images?: unknown;
  audio?: unknown;
}

@Controller('v1/story-videos')
export class StoryVideoController {
  constructor(
    @Inject(StoryVideoService) private readonly service: StoryVideoService,
    @Inject(STORY_VIDEO_CONFIG) private readonly config: StoryVideoConfig,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Get('files/:fileName')
  file(@Param('fileName') fileName: string): StreamableFile {
    const safeName = basename(fileName);
    if (!/\.(mp4|srt)$/i.test(safeName)) {
      throw new NotFoundException('video file not found');
    }
    const filePath = join(this.config.outputDir, safeName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('video file not found');
    }
    const extension = extname(safeName).toLowerCase();
    return new StreamableFile(createReadStream(filePath), {
      type:
        extension === '.mp4'
          ? 'video/mp4'
          : 'application/x-subrip; charset=utf-8',
    });
  }

  @Version(VERSION_NEUTRAL)
  @Post('render')
  @HttpCode(HttpStatus.OK)
  async render(@Body() body: RenderStoryVideoBody) {
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
    try {
      return await this.service.render({
        script,
        images: Array.isArray(body.images) ? body.images : [],
        audio: Array.isArray(body.audio) ? body.audio : [],
      });
    } catch (error) {
      if (error instanceof StoryVideoWorkflowError) {
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
