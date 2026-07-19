import { describe, expect, it } from 'vitest';

import { loadTransportResource } from './resource-loader.js';
import type { MaterializedTransportRequest, TransportDriver } from './types.js';

function bytes(value: string): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(value);
    },
  };
}

describe('transport resource loader', () => {
  it('re-authorizes same-origin redirects and enforces media limits without credentials', async () => {
    const requests: MaterializedTransportRequest[] = [];
    const authorized: string[] = [];
    let redirectBodyDiscarded = false;
    const driver: TransportDriver = {
      send: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? {
              status: 302,
              headers: { location: '/asset.bin' },
              body: {
                [Symbol.asyncIterator]: () => ({
                  next: async () => ({ done: false, value: new Uint8Array() }),
                  return: async () => {
                    redirectBodyDiscarded = true;
                    return { done: true, value: undefined };
                  },
                }),
              },
            }
          : {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
              body: bytes('asset'),
            };
      },
    };

    const result = await loadTransportResource({
      url: new URL('https://media.example/start'),
      driver,
      networkPolicy: {
        authorize: async ({ url, purpose }) => {
          expect(purpose).toBe('media');
          authorized.push(url.href);
        },
      },
      signal: new AbortController().signal,
      maxBytes: 5,
      allowedContentTypes: ['application/octet-stream'],
    });

    expect(new TextDecoder().decode(result.body)).toBe('asset');
    expect(authorized).toEqual([
      'https://media.example/start',
      'https://media.example/asset.bin',
    ]);
    expect(
      requests.every((request) => Object.keys(request.headers).length === 0),
    ).toBe(true);
    expect(redirectBodyDiscarded).toBe(true);
  });

  it('rejects cross-origin redirects and oversized bodies', async () => {
    const redirectDriver: TransportDriver = {
      send: async () => ({
        status: 302,
        headers: { location: 'https://other.example/asset' },
        body: bytes(''),
      }),
    };
    await expect(
      loadTransportResource({
        url: new URL('https://media.example/start'),
        driver: redirectDriver,
        networkPolicy: { authorize: async () => undefined },
        signal: new AbortController().signal,
        maxBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_REDIRECT_NOT_ALLOWED' });

    const bodyDriver: TransportDriver = {
      send: async () => ({
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes('too-large'),
      }),
    };
    await expect(
      loadTransportResource({
        url: new URL('https://media.example/asset'),
        driver: bodyDriver,
        networkPolicy: { authorize: async () => undefined },
        signal: new AbortController().signal,
        maxBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TOO_LARGE' });
  });
});
