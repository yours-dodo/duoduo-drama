import type { StorySpeechGenerator } from '../../ai/story-speech-generator.js';
import type { LinearScript } from '../../contracts/story-script.js';

export type StorySpeechFailureCode = 'agent_unavailable' | 'protocol_error';

export class StorySpeechWorkflowError extends Error {
  constructor(
    readonly failureCode: StorySpeechFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorySpeechWorkflowError';
  }
}

export interface StoryShotAudio {
  shotId: string;
  audioBase64: string;
  mimeType: string;
}

export class StorySpeechWorkflow {
  constructor(private readonly generator: StorySpeechGenerator) {}

  /**
   * Synthesize dialogue shots only. Narration and the player POV ("你") stay
   * silent. A synthesis failure is strict
   * (the workflow raises agent_unavailable); the HTTP caller decides whether
   * to degrade the whole work to silent.
   */
  async generate(input: { script: LinearScript }): Promise<StoryShotAudio[]> {
    const voiceByCharacter = new Map(
      input.script.characters.map((character) => [
        character.name,
        character.voiceDescription,
      ]),
    );
    const voiceIdByCharacter = new Map(
      input.script.characters.map((character) => [
        character.name,
        character.voiceId,
      ]),
    );
    const audio: StoryShotAudio[] = [];

    for (const episode of input.script.episodes) {
      for (const scene of episode.scenes) {
        for (const shot of scene.shots) {
          if (shot.type !== 'dialogue' || !shot.line) continue;
          try {
            const result = await this.generator.synthesize({
              text: shot.line,
              voiceId: shot.speaker
                ? voiceIdByCharacter.get(shot.speaker)
                : undefined,
              voiceDescription: shot.speaker
                ? voiceByCharacter.get(shot.speaker)
                : undefined,
              lineDelivery: shot.lineDelivery,
            });
            audio.push({
              shotId: shot.id,
              audioBase64: result.audioBase64,
              mimeType: result.mimeType,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            throw new StorySpeechWorkflowError(
              'agent_unavailable',
              `shot ${shot.id} speech synthesis failed: ${message}`,
            );
          }
        }
      }
    }

    return audio;
  }
}
