/**
 * Linear drama script contract.
 *
 * The product contract is deliberately branch-free: a user describes the story
 * once, and the agent returns one continuous narrative from opening to ending.
 * The structure mirrors the drama workspace pipeline:
 *   story → episodes → scenes → shots.
 * A shot is the smallest render unit (one image + optional dialogue audio +
 * subtitle), which later phases turn into an ffmpeg segment.
 */

export interface LinearScriptCharacter {
  name: string;
  role: string;
  gender?: string;
  age?: string;
  personality: string;
  goal: string;
  secret?: string;
  /** IndexTTS built-in voice chosen from the available voice catalog. */
  voiceId?: string;
  /** Visual card for the image pipeline (phase 2). */
  visualDescription?: string;
  /** Voice card for the TTS pipeline (phase 3). */
  voiceDescription?: string;
}

export interface LinearScriptShot {
  id: string;
  order: number;
  type: 'narration' | 'dialogue';
  /** Present when type === 'narration'. */
  narration?: string;
  /** Present when type === 'dialogue'. */
  speaker?: string;
  line?: string;
  /** Voice-acting direction for the line; never displayed to the user. */
  lineDelivery?: string;
  /** Cinematic prompt for the image pipeline (phase 2). */
  visualPrompt: string;
  /** Estimated on-screen duration in seconds. */
  durationSeconds: number;
}

export interface LinearScriptScene {
  id: string;
  order: number;
  title: string;
  location: string;
  timeOfDay: string;
  mood: string;
  /** English "location-time" slug used for cross-scene visual continuity. */
  sceneKey?: string;
  shots: LinearScriptShot[];
}

export interface LinearScriptEpisode {
  id: string;
  order: number;
  title: string;
  summary: string;
  scenes: LinearScriptScene[];
}

export interface LinearScript {
  title: string;
  logline: string;
  genre: string;
  synopsis: string;
  /** Art direction applied to every scene image (画风/色调/质感). */
  styleGuide?: string;
  characters: LinearScriptCharacter[];
  episodes: LinearScriptEpisode[];
}

export class StoryScriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryScriptParseError';
  }
}

const MAX_CHARACTERS = 12;
const MAX_EPISODES = 12;
const MAX_SCENES_PER_EPISODE = 12;
const MAX_SHOTS_PER_SCENE = 30;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized.length > 0 ? normalized : undefined;
}

function boundedText(value: unknown, max: number, label: string): string {
  const normalized = text(value);
  if (normalized.length < 1 || normalized.length > max) {
    throw new StoryScriptParseError(`${label} is missing or too long`);
  }
  return normalized;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new StoryScriptParseError(`${label} must be an array`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new StoryScriptParseError(`${label} must be a positive number`);
  }
  return Math.round(value * 10) / 10;
}

function normalizeId(
  value: unknown,
  prefix: string,
  index: number,
  fallback = '',
): string {
  const candidate = text(value, fallback);
  return candidate || `${prefix}-${index + 1}`;
}

function parseCharacter(raw: unknown, index: number): LinearScriptCharacter {
  const source =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};
  const name = boundedText(source.name, 40, `characters[${index}].name`);
  return {
    name,
    role: boundedText(source.role, 40, `${name}.role`),
    gender: optionalText(source.gender),
    age: optionalText(source.age),
    personality: boundedText(
      source.personality,
      500,
      `${name}.personality`,
    ),
    goal: boundedText(source.goal, 500, `${name}.goal`),
    secret: optionalText(source.secret),
    voiceId: optionalText(source.voiceId),
    visualDescription: optionalText(source.visualDescription),
    voiceDescription: optionalText(source.voiceDescription),
  };
}

function parseShot(raw: unknown, index: number): LinearScriptShot {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const type: LinearScriptShot['type'] =
    source.type === 'dialogue' ? 'dialogue' : 'narration';
  const narration = optionalText(source.narration);
  const speaker = optionalText(source.speaker);
  const line = optionalText(source.line);
  if (type === 'narration') {
    if (!narration) {
      throw new StoryScriptParseError(`shots[${index}] narration is required`);
    }
  } else if (!speaker || !line) {
    throw new StoryScriptParseError(
      `shots[${index}] dialogue requires speaker and line`,
    );
  }
  return {
    id: normalizeId(source.id, 'shot', index),
    order: index + 1,
    type,
    narration,
    speaker,
    line,
    lineDelivery: optionalText(source.lineDelivery),
    visualPrompt: boundedText(
      source.visualPrompt,
      2000,
      `shots[${index}].visualPrompt`,
    ),
    durationSeconds: positiveNumber(
      source.durationSeconds,
      `shots[${index}].durationSeconds`,
    ),
  };
}

function parseScene(raw: unknown, index: number): LinearScriptScene {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const shots = asArray(source.shots, `scenes[${index}].shots`).slice(
    0,
    MAX_SHOTS_PER_SCENE,
  );
  if (shots.length < 1) {
    throw new StoryScriptParseError(`scenes[${index}] requires at least one shot`);
  }
  return {
    id: normalizeId(source.id, 'scene', index),
    order: index + 1,
    title: boundedText(source.title, 80, `scenes[${index}].title`),
    location: boundedText(source.location, 120, `scenes[${index}].location`),
    timeOfDay: boundedText(
      source.timeOfDay,
      40,
      `scenes[${index}].timeOfDay`,
    ),
    mood: boundedText(source.mood, 200, `scenes[${index}].mood`),
    sceneKey: optionalText(source.sceneKey),
    shots: shots.map((shot, shotIndex) => parseShot(shot, shotIndex)),
  };
}

function parseEpisode(raw: unknown, index: number): LinearScriptEpisode {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const scenes = asArray(source.scenes, `episodes[${index}].scenes`).slice(
    0,
    MAX_SCENES_PER_EPISODE,
  );
  if (scenes.length < 1) {
    throw new StoryScriptParseError(
      `episodes[${index}] requires at least one scene`,
    );
  }
  return {
    id: normalizeId(source.id, 'episode', index),
    order: index + 1,
    title: boundedText(source.title, 80, `episodes[${index}].title`),
    summary: boundedText(source.summary, 2000, `episodes[${index}].summary`),
    scenes: scenes.map((scene, sceneIndex) => parseScene(scene, sceneIndex)),
  };
}

/** Strip markdown fences so models that wrap JSON in ``` still parse. */
export function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced?.[1]) return fenced[1].trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }
  return trimmed;
}

export function parseLinearScript(raw: string): LinearScript {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(raw));
  } catch {
    throw new StoryScriptParseError('response is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StoryScriptParseError('response must be a JSON object');
  }
  const source = parsed as Record<string, unknown>;
  const characters = asArray(source.characters, 'characters')
    .slice(0, MAX_CHARACTERS)
    .map((character, index) => parseCharacter(character, index));
  const episodes = asArray(source.episodes, 'episodes')
    .slice(0, MAX_EPISODES)
    .map((episode, index) => parseEpisode(episode, index));
  if (episodes.length < 1) {
    throw new StoryScriptParseError('episodes requires at least one episode');
  }
  return {
    title: boundedText(source.title, 120, 'title'),
    logline: boundedText(source.logline, 300, 'logline'),
    genre: boundedText(source.genre, 80, 'genre'),
    synopsis: boundedText(source.synopsis, 5000, 'synopsis'),
    styleGuide: optionalText(source.styleGuide),
    characters,
    episodes,
  };
}

/** Markdown rendering used for human-readable previews and assistant messages. */
export function toLinearScriptMarkdown(script: LinearScript): string {
  const lines: string[] = [];
  lines.push(`# ${script.title}`);
  lines.push('');
  lines.push(`**题材**：${script.genre}`);
  lines.push('');
  lines.push(`**一句话故事**：${script.logline}`);
  lines.push('');
  lines.push(`## 故事梗概`);
  lines.push('');
  lines.push(script.synopsis);
  if (script.characters.length > 0) {
    lines.push('');
    lines.push('## 主要人物');
    lines.push('');
    for (const character of script.characters) {
      lines.push(`- **${character.name}**（${character.role}）：${character.personality}。目标：${character.goal}`);
    }
  }
  for (const episode of script.episodes) {
    lines.push('');
    lines.push(`## 第 ${episode.order} 集 ${episode.title}`);
    lines.push('');
    lines.push(episode.summary);
    for (const scene of episode.scenes) {
      lines.push('');
      lines.push(`### 场景 ${scene.order} ${scene.title}`);
      lines.push('');
      lines.push(`地点：${scene.location} · 时间：${scene.timeOfDay} · 氛围：${scene.mood}`);
      for (const shot of scene.shots) {
        if (shot.type === 'dialogue') {
          lines.push(`- **${shot.speaker}**：${shot.line}`);
        } else {
          lines.push(`- （旁白）${shot.narration}`);
        }
      }
    }
  }
  return lines.join('\n');
}
