import { AiRuntimeError } from '../core/errors.js';

export interface ServerSentEvent {
  readonly event?: string;
  readonly data: string;
}

export async function* parseServerSentEvents(
  body: AsyncIterable<Uint8Array>,
  maxFrameBytes = 1024 * 1024,
  errorCode = 'TRANSPORT_INVALID_SSE',
): AsyncIterable<ServerSentEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > maxFrameBytes)
        throw invalidSse(errorCode, 'SSE frame exceeds the configured limit');
      while (true) {
        const boundary = findBoundary(buffer);
        if (!boundary) break;
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
  } catch (error) {
    if (error instanceof AiRuntimeError) throw error;
    if (error instanceof TypeError)
      throw invalidSse(errorCode, 'SSE stream is not valid UTF-8');
    throw error;
  }
  if (buffer.trim().length > 0)
    throw invalidSse(errorCode, 'SSE stream ended with an incomplete frame');
}

function findBoundary(
  value: string,
): { index: number; length: number } | undefined {
  const lf = value.indexOf('\n\n');
  const crlf = value.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf < lf))
    return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseFrame(frame: string): ServerSentEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine.length === 0 || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return undefined;
  return { ...(event ? { event } : {}), data: data.join('\n') };
}

function invalidSse(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_response', message);
}
