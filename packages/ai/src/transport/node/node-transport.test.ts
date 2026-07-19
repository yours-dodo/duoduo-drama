import { describe, expect, it } from 'vitest';

import { TransportDriverFailure } from '../dispatcher.js';
import type { MaterializedTransportRequest } from '../types.js';
import { connectAuthorizedWebSocket } from '../websocket.js';
import {
  createNodeWebSocketConnector,
  type NodeWebSocketConstructor,
} from './websocket.js';
import { createProxyFetchTransportDriver } from './proxy-fetch.js';

const limits = {
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxErrorBytes: 1024,
  maxFrameBytes: 1024,
};

function request(
  signal = new AbortController().signal,
): MaterializedTransportRequest {
  return {
    url: new URL('https://api.example.com/v1/responses'),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    responseMode: 'stream',
    redirect: 'manual',
    limits,
    signal,
  };
}

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  static readonly instances: FakeSocket[] = [];

  readonly protocol = 'fixture-protocol';
  readonly readyState = 0;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: Array<string | Uint8Array> = [];
  closeCalls = 0;
  terminateCalls = 0;

  constructor(
    readonly url: string,
    readonly protocols: readonly string[] | undefined,
    readonly options: { readonly headers?: Readonly<Record<string, string>> },
  ) {
    FakeSocket.instances.push(this);
  }

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  send(data: string | Uint8Array, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    callback?.();
  }

  close(): void {
    this.closeCalls += 1;
    this.emit('close');
  }

  terminate(): void {
    this.terminateCalls += 1;
    this.emit('close');
  }
}

const FakeWebSocket = FakeSocket as unknown as NodeWebSocketConstructor;

describe('Node transport adapters', () => {
  it('uses the configured proxy dispatcher and preserves manual redirect control', async () => {
    const dispatcher = { kind: 'proxy' };
    let fetchInit: (RequestInit & { dispatcher?: unknown }) | undefined;
    const driver = createProxyFetchTransportDriver({
      proxyUrl: 'http://proxy.example:8080',
      createProxyDispatcher: (url) => {
        expect(url.href).toBe('http://proxy.example:8080/');
        return dispatcher;
      },
      fetch: async (_url, init) => {
        fetchInit = init;
        return new Response('ok', {
          status: 200,
          headers: { 'x-fixture': 'yes' },
        });
      },
    });

    const response = await driver.send(request());
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) chunks.push(chunk);

    expect(fetchInit).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      dispatcher,
    });
    expect(response.headers['x-fixture']).toBe('yes');
    expect(new TextDecoder().decode(chunks[0])).toBe('ok');
  });

  it('classifies aborted proxy fetches as timeout failures', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('timed out', 'TimeoutError'));
    const driver = createProxyFetchTransportDriver({
      fetch: async () => {
        throw new Error('fetch failed');
      },
    });

    await expect(driver.send(request(controller.signal))).rejects.toMatchObject(
      {
        phase: 'dispatch_unknown',
        kind: 'timeout',
      } satisfies Partial<TransportDriverFailure>,
    );
  });

  it('authorizes WebSocket targets and exposes send, receive, close, and dispose', async () => {
    FakeSocket.instances.length = 0;
    const authorized: string[] = [];
    const connector = createNodeWebSocketConnector({
      WebSocket: FakeWebSocket,
    });
    const connecting = connectAuthorizedWebSocket({
      url: new URL('wss://api.example.com/realtime'),
      protocols: ['fixture'],
      headers: { authorization: 'Bearer fixture' },
      connector,
      networkPolicy: {
        authorize: async ({ url }) => {
          authorized.push(url.href);
        },
      },
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    const raw = FakeSocket.instances[0]!;
    raw.emit('open');
    const socket = await connecting;

    expect(authorized).toEqual(['wss://api.example.com/realtime']);
    expect(raw.url).toBe('wss://api.example.com/realtime');
    expect(raw.protocols).toEqual(['fixture']);
    expect(raw.options.headers).toEqual({ authorization: 'Bearer fixture' });
    expect(socket.protocol).toBe('fixture-protocol');

    await socket.send('hello');
    expect(raw.sent).toEqual(['hello']);

    const iterator = socket[Symbol.asyncIterator]();
    raw.emit('message', new TextEncoder().encode('world'));
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: new TextEncoder().encode('world'),
    });

    await socket.close(1000, 'done');
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    const secondConnecting = connector.connect({
      url: new URL('wss://api.example.com/other'),
      signal: new AbortController().signal,
    });
    const second = FakeSocket.instances[1]!;
    second.emit('open');
    await secondConnecting;
    await connector.dispose?.();
    expect(second.terminateCalls).toBe(1);
  });

  it('fails closed before constructing an already-aborted WebSocket', async () => {
    FakeSocket.instances.length = 0;
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const connector = createNodeWebSocketConnector({
      WebSocket: FakeWebSocket,
    });

    await expect(
      connector.connect({
        url: new URL('wss://api.example.com/realtime'),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
