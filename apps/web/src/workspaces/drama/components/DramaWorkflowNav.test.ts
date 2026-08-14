import { describe, expect, it } from 'vitest';

import { dramaWorkflowSteps } from './DramaWorkflowNav';

describe('drama workflow', () => {
  it('starts with creation before production steps', () => {
    expect(dramaWorkflowSteps[0]).toMatchObject({
      id: 'creation',
      label: '创作',
    });
    expect(dramaWorkflowSteps.map((step) => step.id)).toEqual([
      'creation',
      'episodes',
      'scenes',
      'shots',
      'assets',
    ]);
  });
});
