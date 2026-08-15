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
import { StorySpeechService } from './story-speech.service.js';
import { StorySpeechWorkflowError } from './workflows/story-speech/story-speech.workflow.js';

interface GenerateStorySpeechBody {
  script?: unknown;
}

@Controller('v1/story-speech')
export class StorySpeechController {
  constructor(
    @Inject(StorySpeechService) private readonly service: StorySpeechService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateStorySpeechBody) {
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
      return await this.service.generate({ script });
    } catch (error) {
      if (error instanceof StorySpeechWorkflowError) {
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

