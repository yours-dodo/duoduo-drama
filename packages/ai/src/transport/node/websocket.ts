import { AiRuntimeError } from '../../core/errors.js';
import type {
  TransportWebSocket,
  WebSocketConnector,
  WebSocketData,
} from '../websocket.js';

interface NodeWebSocketLike {
  readonly protocol?: string;
  readonly readyState: number;
  send(data: string | Uint8Array, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

export interface NodeWebSocketConstructor {
  new (
    url: string,
    protocols: readonly string[] | undefined,
    options: { readonly headers?: Readonly<Record<string, string>> },
  ): NodeWebSocketLike;
}

export function createNodeWebSocketConnector(options: {
  readonly WebSocket: NodeWebSocketConstructor;
}): WebSocketConnector {
  const sockets = new Set<NodeWebSocketLike>();
  return Object.freeze({
    connect: async (request: {
      readonly url: URL;
      readonly protocols?: readonly string[];
      readonly headers?: Readonly<Record<string, string>>;
      readonly signal: AbortSignal;
    }) => {
      if (request.signal.aborted) throw abortReason(request.signal);
      const socket = new options.WebSocket(
        request.url.href,
        request.protocols,
        { headers: request.headers },
      );
      sockets.add(socket);
      await waitForOpen(socket, request.signal);
      const queue: WebSocketData[] = [];
      const waiters: Array<(value: IteratorResult<WebSocketData>) => void> = [];
      let closed = false;
      socket.on('message', (data) => {
        const value = normalizeData(data);
        const waiter = waiters.shift();
        if (waiter) waiter({ done: false, value });
        else queue.push(value);
      });
      socket.on('close', () => {
        closed = true;
        sockets.delete(socket);
        for (const waiter of waiters.splice(0))
          waiter({ done: true, value: undefined });
      });
      const transport: TransportWebSocket = {
        protocol: socket.protocol ?? '',
        send: (data) =>
          new Promise<void>((resolve, reject) =>
            socket.send(data, (error) => (error ? reject(error) : resolve())),
          ),
        close: async (code, reason) => {
          if (!closed) socket.close(code, reason);
        },
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            const value = queue.shift();
            if (value !== undefined) return { done: false, value };
            if (closed) return { done: true, value: undefined };
            return new Promise<IteratorResult<WebSocketData>>((resolve) =>
              waiters.push(resolve),
            );
          },
        }),
      };
      return Object.freeze(transport);
    },
    dispose: async () => {
      for (const socket of sockets) terminateOrClose(socket);
      sockets.clear();
    },
  });
}

function waitForOpen(
  socket: NodeWebSocketLike,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      terminateOrClose(socket);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    socket.on('open', () => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    socket.on('error', (error) => {
      signal.removeEventListener('abort', abort);
      reject(
        new AiRuntimeError(
          'WEBSOCKET_CONNECT_FAILED',
          'network',
          'WebSocket connection failed',
          true,
          { causeName: error.name },
        ),
      );
    });
  });
}

function terminateOrClose(socket: NodeWebSocketLike): void {
  if (socket.terminate) socket.terminate();
  else socket.close();
}

function normalizeData(data: unknown): WebSocketData {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new AiRuntimeError(
    'WEBSOCKET_FRAME_INVALID',
    'invalid_response',
    'WebSocket frame has an unsupported type',
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}
