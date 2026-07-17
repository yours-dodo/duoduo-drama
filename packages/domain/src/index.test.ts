import { describe, expect, it } from 'vitest';

import { projectId } from './index.js';

describe('projectId', () => {
  it('normalizes a non-empty project ID', () => {
    expect(projectId(' project-1 ')).toBe('project-1');
  });

  it('rejects an empty project ID', () => {
    expect(() => projectId('   ')).toThrow('Project ID cannot be empty.');
  });
});
