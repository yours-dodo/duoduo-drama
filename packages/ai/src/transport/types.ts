export type TransportBody = string | Uint8Array | ReadableStream<Uint8Array>;
export type TransportResponseMode = 'bytes' | 'json' | 'stream';

export interface TransportLimits {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxErrorBytes: number;
  readonly maxFrameBytes: number;
}

export interface BoundTransportRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: TransportBody;
  readonly responseMode: TransportResponseMode;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface MaterializedTransportRequest {
  readonly url: URL;
  readonly method: BoundTransportRequest['method'];
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: TransportBody;
  readonly responseMode: TransportResponseMode;
  readonly redirect: 'manual';
  readonly limits: TransportLimits;
  readonly signal: AbortSignal;
}

export interface TransportDriver {
  send(request: MaterializedTransportRequest): Promise<TransportResponse>;
  dispose?(): Promise<void>;
}

export interface NetworkPolicy {
  authorize(
    request: {
      readonly url: URL;
      readonly purpose: 'model' | 'catalog' | 'oauth' | 'media';
      readonly redirectFrom?: URL;
    },
    signal: AbortSignal,
  ): Promise<void>;
}

export interface RequestTransport {
  send(request: BoundTransportRequest): Promise<TransportResponse>;
}
