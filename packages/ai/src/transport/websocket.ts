import type { NetworkPolicy } from './types.js';

export type WebSocketData = string | Uint8Array;

export interface TransportWebSocket extends AsyncIterable<WebSocketData> {
  readonly protocol: string;
  send(data: WebSocketData): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
}

export interface WebSocketConnector {
  connect(request: {
    readonly url: URL;
    readonly protocols?: readonly string[];
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }): Promise<TransportWebSocket>;
  dispose?(): Promise<void>;
}

export async function connectAuthorizedWebSocket(input: {
  readonly url: URL;
  readonly protocols?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly connector: WebSocketConnector;
  readonly networkPolicy: NetworkPolicy;
  readonly signal: AbortSignal;
}): Promise<TransportWebSocket> {
  await input.networkPolicy.authorize(
    { url: new URL(input.url), purpose: 'model' },
    input.signal,
  );
  return input.connector.connect({
    url: new URL(input.url),
    protocols: input.protocols,
    headers: input.headers,
    signal: input.signal,
  });
}
