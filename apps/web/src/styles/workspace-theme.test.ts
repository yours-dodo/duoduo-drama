import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workspaceStyles = readFileSync(
  new URL('./workspace.css', import.meta.url),
  'utf8',
);

describe('workspace theme interactions', () => {
  it('hides the workspace header navigation', () => {
    expect(workspaceStyles).toMatch(
      /body\.workspace-theme \.site-header nav\s*\{[^}]*display:\s*none;/s,
    );
  });

  it('uses fluorescent accents and a breathing glow on hovered workspace cards', () => {
    expect(workspaceStyles).toContain('--workspace-story-hover: #ff6a00;');
    expect(workspaceStyles).toContain(
      '--workspace-story-hover-glow: rgba(255, 106, 0, 0.48);',
    );
    expect(workspaceStyles).toContain('--workspace-drama-hover: #c8ff43;');
    expect(workspaceStyles).toContain(
      '--workspace-drama-hover-glow: rgba(200, 255, 67, 0.46);',
    );
    expect(workspaceStyles).toContain('@keyframes workspace-story-breathe');
    expect(workspaceStyles).toContain('@keyframes workspace-drama-breathe');
    expect(workspaceStyles).toMatch(
      /\.story-entry:hover,[\s\S]*?animation:\s*workspace-story-breathe 2\.6s ease-in-out infinite;/,
    );
    expect(workspaceStyles).toMatch(
      /\.drama-entry:hover,[\s\S]*?animation:\s*workspace-drama-breathe 2\.6s ease-in-out infinite;/,
    );
    expect(workspaceStyles).not.toContain('.workspace-entry-grid::before');
    expect(workspaceStyles).not.toContain(
      'body.workspace-theme .story-entry:hover .workspace-visual-core',
    );
  });
});
