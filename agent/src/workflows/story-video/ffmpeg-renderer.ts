import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FfmpegRendererConfig {
  ffmpegPath: string;
  ffprobePath: string;
  width: number;
  height: number;
  fps: number;
}

export interface RenderedAsset {
  imageFile: string;
  audioFile?: string;
}

export class FfmpegError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool} failed: ${message}`);
    this.name = 'FfmpegError';
  }
}

function run(
  tool: string,
  args: readonly string[],
  timeoutMs = 300_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      [...args],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new FfmpegError(
              tool,
              stderr?.toString().trim().split('\n').slice(-5).join('\n') ||
                error.message,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}

export async function probeDurationSeconds(
  ffprobePath: string,
  file: string,
): Promise<number | undefined> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString().trim());
      },
    );
  });
  const seconds = Number(output);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export async function materializeDataUri(
  dataUri: string,
  directory: string,
  name: string,
): Promise<{ path: string; mimeType: string }> {
  const match = dataUri.match(
    /^data:([^;,]+)?(?:;charset=[^;,]*)?(;base64)?,(.*)$/s,
  );
  if (!match) throw new FfmpegError('ffmpeg', `invalid data URI for ${name}`);
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';
  const bytes = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload));
  return writeMaterialized(directory, name, mimeType, bytes);
}

/**
 * Load a scene image from a `data:` URI or an http(s) URL and materialize it
 * for ffmpeg. SVG is rasterized to PNG (this ffmpeg build has no librsvg).
 */
export async function materializeImageSource(
  source: string,
  directory: string,
  name: string,
): Promise<{ path: string; mimeType: string }> {
  if (source.startsWith('data:')) {
    return materializeDataUri(source, directory, name);
  }
  const response = await fetch(source);
  if (!response.ok) {
    throw new FfmpegError(
      'ffmpeg',
      `failed to fetch image ${name}: HTTP ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType =
    response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim() || 'image/png';
  return writeMaterialized(directory, name, mimeType, bytes);
}

export interface SubtitleOverlayOptions {
  width: number;
  height: number;
  fontSize?: number;
  maxLines?: number;
}

/**
 * Render a subtitle line into a full-canvas transparent PNG overlay via
 * SVG + macOS `sips` (this ffmpeg build has neither libass nor drawtext).
 * The caller overlays the PNG on the segment video.
 */
export async function renderSubtitleOverlay(
  text: string,
  directory: string,
  name: string,
  options: SubtitleOverlayOptions,
): Promise<string> {
  const svgPath = join(directory, `${name}.svg`);
  const pngPath = join(directory, `${name}.png`);
  await writeFile(svgPath, buildSubtitleSvg(text, options), 'utf8');
  await run('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath]);
  await rm(svgPath, { force: true });
  return pngPath;
}

/** Pure SVG builder (unit-testable): wrapped subtitle at the bottom. */
export function buildSubtitleSvg(
  text: string,
  options: SubtitleOverlayOptions,
): string {
  const { width, height } = options;
  const fontSize = options.fontSize ?? Math.round(width / 20);
  const maxLines = options.maxLines ?? 2;
  const padding = Math.round(width * 0.045);
  const lineHeight = Math.round(fontSize * 1.3);
  const usableWidth = width - padding * 2;
  const charsPerLine = Math.max(1, Math.floor(usableWidth / fontSize));
  const lines = wrapCjk(text, charsPerLine, maxLines);
  const blockHeight = lines.length * lineHeight + fontSize * 0.5;
  const y = height - blockHeight - Math.round(height * 0.06);

  const textLines = lines
    .map(
      (line, index) =>
        `<text x="${width / 2}" y="${y + fontSize * 1.05 + index * lineHeight}" ` +
        `font-family="PingFang SC, STHeiti, sans-serif" font-size="${fontSize}" ` +
        `fill="#FFFFFF" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join('\n');

  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` width="${width}" height="${height}">`,
    `<rect x="${padding - 10}" y="${y - fontSize * 0.3}" width="${width - (padding - 10) * 2}" ` +
      `height="${blockHeight + fontSize * 0.5}" fill="rgba(0,0,0,0.55)" rx="16"/>`,
    textLines,
    '</svg>',
  ].join('');
}

export function wrapCjk(text: string, charsPerLine: number, maxLines: number): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const lines: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= charsPerLine) {
      lines.push(remaining);
      break;
    }
    if (lines.length === maxLines - 1) {
      lines.push(`${remaining.slice(0, Math.max(1, charsPerLine - 1))}…`);
      break;
    }
    lines.push(remaining.slice(0, charsPerLine));
    remaining = remaining.slice(charsPerLine);
  }
  return lines.length > 0 ? lines : [''];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function writeMaterialized(
  directory: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ path: string; mimeType: string }> {
  const extension = extensionForMime(mimeType);
  const path = join(directory, `${name}${extension}`);
  await writeFile(path, bytes);
  if (mimeType === 'image/svg+xml') {
    // This ffmpeg build has no librsvg; rasterize SVG through macOS `sips`.
    const pngPath = join(directory, `${name}.png`);
    await run('sips', ['-s', 'format', 'png', path, '--out', pngPath]);
    await rm(path, { force: true });
    return { path: pngPath, mimeType: 'image/png' };
  }
  return { path, mimeType };
}

export function extensionForMime(mimeType: string): string {
  if (mimeType.includes('svg')) return '.svg';
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
  if (mimeType.includes('aac')) return '.aac';
  if (mimeType.includes('ogg')) return '.ogg';
  return '.bin';
}

export async function renderSegment(
  config: FfmpegRendererConfig,
  input: {
    imageFile: string;
    audioFile?: string;
    subtitleOverlay?: string;
    durationSeconds: number;
    /** Zoom level at the start of this segment (continuous within a scene). */
    zoomStart?: number;
    zoomMax?: number;
    /** Output base path without extension; writes `${base}.mp4` + `${base}.wav`. */
    outputBase: string;
  },
): Promise<{ videoFile: string; audioFile: string }> {
  const frames = Math.max(1, Math.round(input.durationSeconds * config.fps));
  const videoFile = `${input.outputBase}.mp4`;
  const audioFile = `${input.outputBase}.wav`;
  const zoomStart = input.zoomStart ?? 1;
  const zoomMax = input.zoomMax ?? 1.1;
  // `on` counts output frames within this zoompan run, so the push-in starts
  // at `zoomStart` instead of resetting to 1 on every segment (which made the
  // picture jump back and replay the animation at each cut).
  const zoom = `zoompan=z='min(${zoomStart}+0.0006*on,${zoomMax})':d=${frames}:s=${config.width}x${config.height}:fps=${config.fps}`;

  // Video pass: image (+ optional subtitle overlay) → h264, no audio.
  const videoArgs = ['-y', '-i', input.imageFile];
  if (input.subtitleOverlay) videoArgs.push('-i', input.subtitleOverlay);
  const composed = input.subtitleOverlay
    ? `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase,crop=${config.width}:${config.height},${zoom},format=yuv420p[base];` +
      `[base][1:v]overlay=0:0:format=auto[vo]`
    : `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase,crop=${config.width}:${config.height},${zoom},format=yuv420p[v]`;
  videoArgs.push(
    '-filter_complex',
    composed,
    '-map',
    input.subtitleOverlay ? '[vo]' : '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-an',
    '-t',
    String(input.durationSeconds),
    videoFile,
  );
  await run(config.ffmpegPath, videoArgs);

  // Audio pass: PCM 22050 Hz mono, exactly `durationSeconds` long. PCM has no
  // codec delay, so concatenating later is sample-exact and pop-free.
  const audioArgs = ['-y'];
  if (input.audioFile) {
    audioArgs.push('-i', input.audioFile);
  } else {
    audioArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono');
  }
  audioArgs.push(
    '-ar',
    '22050',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-t',
    String(input.durationSeconds),
    audioFile,
  );
  await run(config.ffmpegPath, audioArgs);
  return { videoFile, audioFile };
}

export async function concatSegments(
  config: FfmpegRendererConfig,
  input: {
    videoFiles: readonly string[];
    audioFiles: readonly string[];
    outputFile: string;
  },
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'duoduo-concat-'));
  try {
    const videoConcat = join(directory, 'video.mp4');
    const audioConcat = join(directory, 'audio.wav');
    if (input.videoFiles.length === 1) {
      await run('cp', [input.videoFiles[0]!, videoConcat]);
    } else {
      const listFile = join(directory, 'video-list.txt');
      await writeFile(listFile, concatList(input.videoFiles));
      await run(config.ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy',
        videoConcat,
      ]);
    }
    if (input.audioFiles.length === 1) {
      await run('cp', [input.audioFiles[0]!, audioConcat]);
    } else {
      const listFile = join(directory, 'audio-list.txt');
      await writeFile(listFile, concatList(input.audioFiles));
      await run(config.ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy',
        audioConcat,
      ]);
    }
    // One final AAC encode over the whole timeline (not per segment), so the
    // encoder runs continuously and no segment boundary clicks can occur.
    await run(config.ffmpegPath, [
      '-y',
      '-i',
      videoConcat,
      '-i',
      audioConcat,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      '22050',
      '-ac',
      '1',
      '-b:a',
      '128k',
      '-shortest',
      input.outputFile,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function concatList(files: readonly string[]): string {
  return (
    files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') +
    '\n'
  );
}

export async function readFileBytes(path: string): Promise<number> {
  return (await readFile(path)).length;
}
