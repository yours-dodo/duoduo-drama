import { describe, expect, it, vi } from 'vitest';
import { BoundedObserverQueue } from './bounded-queue.js';
import { AttemptLocalSink } from './attempt-sink.js';

describe('bounded observer queue', () => {
  it('backpressures writers until the observer frees capacity', async () => {
    const queue = new BoundedObserverQueue<string>({
      maxItems: 1,
      maxBytes: 8,
      sizeOf: (value) => value.length,
    });
    await expect(queue.push('first')).resolves.toBe(true);
    let settled = false;
    const blocked = queue.push('second').then((accepted) => {
      settled = true;
      return accepted;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(queue.shift()).toBe('first');
    await expect(blocked).resolves.toBe(true);
    expect(queue.shift()).toBe('second');
  });

  it('rejects an item that can never fit instead of blocking forever', async () => {
    const queue = new BoundedObserverQueue<string>({
      maxItems: 1,
      maxBytes: 3,
      sizeOf: (value) => value.length,
    });

    await expect(queue.push('oversized')).rejects.toThrowError(
      'queue item exceeds maxBytes',
    );
  });

  it('drops late attempt events without calling the runtime writer', async () => {
    const onPublish = vi.fn(async () => undefined);
    const onLateEvent = vi.fn();
    const sink = new AttemptLocalSink({ onPublish, onLateEvent });
    sink.close();
    await sink.publish({
      type: 'text_start',
      itemId: 'text-0',
      contentIndex: 0,
    });
    expect(onPublish).not.toHaveBeenCalled();
    expect(onLateEvent).toHaveBeenCalledOnce();
  });
});
