import { describe, expect, it } from 'vitest';

import { parseBedrockEventStream } from './eventstream.js';

const encoder = new TextEncoder();

describe('Bedrock AWS event stream parser', () => {
  it('parses a binary AWS event-stream frame split across chunks', async () => {
    const frame = encodeFrame(
      { ':message-type': 'event', ':event-type': 'messageStop' },
      { stopReason: 'end_turn' },
    );

    await expect(
      collect(
        parseBedrockEventStream(
          chunks(frame.slice(0, 7), frame.slice(7, 19), frame.slice(19)),
        ),
      ),
    ).resolves.toEqual([{ type: 'messageStop', stopReason: 'end_turn' }]);
  });

  it('rejects a binary frame with a corrupted CRC', async () => {
    const frame = encodeFrame(
      { ':message-type': 'event', ':event-type': 'messageStop' },
      { stopReason: 'end_turn' },
    );
    frame[frame.byteLength - 1] ^= 0xff;

    await expect(
      collect(parseBedrockEventStream(chunks(frame))),
    ).rejects.toMatchObject({ code: 'BEDROCK_EVENT_STREAM_INVALID' });
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

function encodeFrame(
  headers: Readonly<Record<string, string>>,
  payload: Record<string, unknown>,
): Uint8Array {
  const headerBytes = concat(
    ...Object.entries(headers).map(([name, value]) =>
      encodeHeader(name, value),
    ),
  );
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const totalLength = 16 + headerBytes.byteLength + payloadBytes.byteLength;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerBytes.byteLength, false);
  view.setUint32(8, crc32(frame.subarray(0, 8)), false);
  frame.set(headerBytes, 12);
  frame.set(payloadBytes, 12 + headerBytes.byteLength);
  view.setUint32(
    totalLength - 4,
    crc32(frame.subarray(0, totalLength - 4)),
    false,
  );
  return frame;
}

function encodeHeader(name: string, value: string): Uint8Array {
  const nameBytes = encoder.encode(name);
  const valueBytes = encoder.encode(value);
  const output = new Uint8Array(
    1 + nameBytes.byteLength + 3 + valueBytes.byteLength,
  );
  output[0] = nameBytes.byteLength;
  output.set(nameBytes, 1);
  output[1 + nameBytes.byteLength] = 7;
  new DataView(output.buffer).setUint16(
    2 + nameBytes.byteLength,
    valueBytes.byteLength,
    false,
  );
  output.set(valueBytes, 4 + nameBytes.byteLength);
  return output;
}

function concat(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    values.reduce((sum, value) => sum + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
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
