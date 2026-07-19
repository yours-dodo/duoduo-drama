import { AiRuntimeError } from '../../core/errors.js';

export interface BedrockStreamEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export async function* parseBedrockEventStream(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<BedrockStreamEvent> {
  let mode: 'jsonl' | 'eventstream' | undefined;
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    if (!mode) {
      const first = firstNonWhitespace(chunk);
      if (first !== undefined) mode = first === 0x7b ? 'jsonl' : 'eventstream';
    }
    if (mode === 'jsonl') {
      text += decoder.decode(chunk, { stream: true });
      while (true) {
        const newline = text.indexOf('\n');
        if (newline < 0) break;
        const line = text.slice(0, newline).trim();
        text = text.slice(newline + 1);
        if (line) yield parseJsonEvent(line);
      }
      continue;
    }
    bytes = concat(bytes, chunk);
    while (bytes.byteLength >= 12) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const totalLength = view.getUint32(0, false);
      const headersLength = view.getUint32(4, false);
      if (
        totalLength < 16 ||
        headersLength > totalLength - 16 ||
        totalLength > 32 * 1024 * 1024
      )
        throw invalidEventStream('invalid frame lengths');
      if (bytes.byteLength < totalLength) break;
      const frame = bytes.slice(0, totalLength);
      bytes = bytes.slice(totalLength);
      validateFrameCrcs(frame);
      yield decodeEventStreamFrame(frame, headersLength);
    }
  }
  if (mode === 'jsonl') {
    text += decoder.decode();
    const line = text.trim();
    if (line) yield parseJsonEvent(line);
    return;
  }
  if (bytes.byteLength !== 0)
    throw invalidEventStream('truncated event stream frame');
}

function validateFrameCrcs(frame: Uint8Array): void {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint32(8, false) !== crc32(frame.subarray(0, 8)))
    throw invalidEventStream('invalid prelude CRC');
  if (
    view.getUint32(frame.byteLength - 4, false) !==
    crc32(frame.subarray(0, frame.byteLength - 4))
  )
    throw invalidEventStream('invalid message CRC');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeEventStreamFrame(
  frame: Uint8Array,
  headersLength: number,
): BedrockStreamEvent {
  const headers = decodeHeaders(frame.slice(12, 12 + headersLength));
  const payload = frame.slice(12 + headersLength, frame.byteLength - 4);
  let value: Record<string, unknown> = {};
  if (payload.byteLength) {
    try {
      value = object(JSON.parse(new TextDecoder().decode(payload)));
    } catch {
      throw invalidEventStream('invalid JSON payload');
    }
  }
  const messageType = headers[':message-type'];
  const type =
    messageType === 'exception'
      ? headers[':exception-type']
      : headers[':event-type'];
  if (!type) throw invalidEventStream('missing event type header');
  return Object.freeze({ type, ...value });
}

function decodeHeaders(bytes: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  let offset = 0;
  while (offset < bytes.byteLength) {
    const nameLength = bytes[offset++];
    if (nameLength === undefined || offset + nameLength + 1 > bytes.byteLength)
      throw invalidEventStream('invalid header name');
    const name = new TextDecoder().decode(
      bytes.slice(offset, offset + nameLength),
    );
    offset += nameLength;
    const type = bytes[offset++];
    if (type === 7) {
      if (offset + 2 > bytes.byteLength)
        throw invalidEventStream('invalid string header');
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      offset += 2;
      if (offset + length > bytes.byteLength)
        throw invalidEventStream('truncated string header');
      headers[name] = new TextDecoder().decode(
        bytes.slice(offset, offset + length),
      );
      offset += length;
      continue;
    }
    if (type === 0 || type === 1) {
      headers[name] = type === 0 ? 'true' : 'false';
      continue;
    }
    throw invalidEventStream(`unsupported header type ${String(type)}`);
  }
  return headers;
}

function parseJsonEvent(line: string): BedrockStreamEvent {
  try {
    const value = object(JSON.parse(line));
    const type = typeof value.type === 'string' ? value.type : undefined;
    if (!type) throw invalidEventStream('JSON event type is missing');
    return value as BedrockStreamEvent;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw error;
    throw invalidEventStream('invalid JSON event');
  }
}

function firstNonWhitespace(bytes: Uint8Array): number | undefined {
  for (const value of bytes)
    if (value !== 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d)
      return value;
  return undefined;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left);
  output.set(right, left.byteLength);
  return output;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function invalidEventStream(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'BEDROCK_EVENT_STREAM_INVALID',
    'invalid_response',
    message,
  );
}
