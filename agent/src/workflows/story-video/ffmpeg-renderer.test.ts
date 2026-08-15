import { describe, expect, it } from 'vitest';

import { buildSubtitleSvg, wrapCjk } from './ffmpeg-renderer.js';

describe('wrapCjk', () => {
  it('wraps long text into multiple lines', () => {
    const lines = wrapCjk('一二三四五六七八九十', 5, 2);
    expect(lines).toEqual(['一二三四五', '六七八九十']);
  });

  it('adds an ellipsis on the last allowed line', () => {
    const lines = wrapCjk('一二三四五六七八九十一二三四五', 6, 2);
    expect(lines).toEqual(['一二三四五六', '七八九十一…']);
  });

  it('keeps short text on one line', () => {
    expect(wrapCjk('你好', 10, 2)).toEqual(['你好']);
  });
});

describe('buildSubtitleSvg', () => {
  it('produces a full-canvas SVG with wrapped text and background', () => {
    const svg = buildSubtitleSvg('林晚：潮水退了以后，所有东西都会回来。', {
      width: 1080,
      height: 1920,
      fontSize: 54,
      maxLines: 2,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('rx="16"');
    expect(svg).toContain('林晚：');
    expect(svg).toContain('font-family="PingFang SC, STHeiti, sans-serif"');
  });

  it('escapes XML-sensitive characters', () => {
    const svg = buildSubtitleSvg('他说：<很好> & "谢谢"', {
      width: 1080,
      height: 1920,
      fontSize: 54,
    });
    expect(svg).not.toContain('<很好>');
    expect(svg).toContain('&lt;很好&gt;');
  });
});
