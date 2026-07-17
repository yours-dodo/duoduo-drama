import { describe, expect, it } from 'vitest';

import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports server health', () => {
    expect(new AppController().health()).toEqual({
      service: 'server',
      status: 'ok',
    });
  });
});
