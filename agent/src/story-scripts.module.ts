import { Module } from '@nestjs/common';

import {
  STORY_IMAGE_CONFIG,
  parseStoryImageConfig,
} from './config/story-image-config.js';
import {
  STORY_SPEECH_CONFIG,
  parseStorySpeechConfig,
} from './config/story-speech-config.js';
import { STORY_SCRIPT_CONFIG, parseStoryScriptConfig } from './config/story-script-config.js';
import {
  STORY_VIDEO_CONFIG,
  parseStoryVideoConfig,
} from './config/story-video-config.js';
import { StoryImagesController } from './story-images.controller.js';
import { StoryImagesService } from './story-images.service.js';
import { StorySpeechController } from './story-speech.controller.js';
import { StorySpeechService } from './story-speech.service.js';
import { StoryScriptsController } from './story-scripts.controller.js';
import { StoryScriptsService } from './story-scripts.service.js';
import { StoryTaskController } from './story-task.controller.js';
import { StoryTaskService } from './story-task.service.js';
import { StoryVideoController } from './story-video.controller.js';
import { StoryVideoService } from './story-video.service.js';

@Module({
  controllers: [
    StoryScriptsController,
    StoryImagesController,
    StorySpeechController,
    StoryVideoController,
    StoryTaskController,
  ],
  providers: [
    {
      provide: STORY_SCRIPT_CONFIG,
      useFactory: () => parseStoryScriptConfig(process.env),
    },
    {
      provide: STORY_IMAGE_CONFIG,
      useFactory: () => parseStoryImageConfig(process.env),
    },
    {
      provide: STORY_SPEECH_CONFIG,
      useFactory: () => parseStorySpeechConfig(process.env),
    },
    {
      provide: STORY_VIDEO_CONFIG,
      useFactory: () => parseStoryVideoConfig(process.env),
    },
    StoryScriptsService,
    StoryImagesService,
    StorySpeechService,
    StoryVideoService,
    StoryTaskService,
  ],
})
export class StoryScriptsModule {}
