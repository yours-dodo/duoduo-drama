import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const themeStyles = readFileSync(
  new URL('./theme.css', import.meta.url),
  'utf8',
);

describe('shared system theme contract', () => {
  it('defines one dark/light semantic palette for non-drama pages', () => {
    expect(themeStyles).toContain("html[data-theme='dark']");
    expect(themeStyles).toContain("html[data-theme='light']");
    expect(themeStyles).toContain('--theme-canvas: #080808;');
    expect(themeStyles).toContain('--theme-canvas: #f5f5f3;');
    expect(themeStyles).toContain('html[data-theme] body:not(.drama-page)');
  });

  it('keeps short-drama styling outside the shared token bridge', () => {
    expect(themeStyles).toContain('body:not(.drama-page)');
    expect(themeStyles).not.toContain('body.drama-page {');
  });

  it('maps workspace, story, and works tokens to the shared palette', () => {
    expect(themeStyles).toContain('html[data-theme] body.workspace-theme');
    expect(themeStyles).toContain('html[data-theme] body.story-page');
    expect(themeStyles).toContain('html[data-theme] body.works-page');
    expect(themeStyles).toContain('--works-accent: var(--theme-brand);');
    expect(themeStyles).toContain('--public-canvas: var(--theme-canvas);');
    expect(themeStyles).toContain('--auth-rewrite-accent: var(--theme-brand);');
    expect(themeStyles).toContain('--levels-primary: var(--theme-brand);');
  });
});
