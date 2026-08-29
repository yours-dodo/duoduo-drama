import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StoryOutlineAutosave,
  type StoryOutlineAutosaveBatch,
  type StoryOutlineAutosaveState,
} from './story-outline-autosave';

afterEach(() => {
  vi.useRealTimers();
});

describe('StoryOutlineAutosave', () => {
  it('coalesces edits into one delayed version batch', async () => {
    vi.useFakeTimers();
    let content = 'v2:first';
    const save = vi.fn(async (batch: StoryOutlineAutosaveBatch) => ({
      number: batch.expectedVersionNumber! + 1,
    }));
    const autosave = new StoryOutlineAutosave({
      readContent: () => content,
      readExpectedVersionNumber: () => 4,
      createIdempotencyKey: () => 'batch-1',
      save,
      onSaved: vi.fn(),
    });

    autosave.schedule();
    content = 'v2:latest';
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      content: 'v2:latest',
      expectedVersionNumber: 4,
      idempotencyKey: 'batch-1',
    });
  });

  it('queues edits made while a save is in flight for the next version', async () => {
    vi.useFakeTimers();
    let content = 'version-2';
    let versionNumber = 1;
    let resolveFirst: ((value: { number: number }) => void) | null = null;
    const save = vi
      .fn<(batch: StoryOutlineAutosaveBatch) => Promise<{ number: number }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () => ({ number: 3 }));
    const autosave = new StoryOutlineAutosave({
      readContent: () => content,
      readExpectedVersionNumber: () => versionNumber,
      createIdempotencyKey: () => `batch-${save.mock.calls.length + 1}`,
      save,
      onSaved: (version) => {
        versionNumber = version.number;
      },
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    content = 'version-3';
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.({ number: 2 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      content: 'version-3',
      expectedVersionNumber: 2,
    });
  });

  it('retries a failed batch with the same idempotency key before newer edits', async () => {
    vi.useFakeTimers();
    let content = 'version-2';
    let versionNumber = 1;
    let keySequence = 0;
    const states: StoryOutlineAutosaveState[] = [];
    const save = vi
      .fn<(batch: StoryOutlineAutosaveBatch) => Promise<{ number: number }>>()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ number: 2 })
      .mockResolvedValueOnce({ number: 3 });
    const autosave = new StoryOutlineAutosave({
      readContent: () => content,
      readExpectedVersionNumber: () => versionNumber,
      createIdempotencyKey: () => `batch-${++keySequence}`,
      save,
      onSaved: (version) => {
        versionNumber = version.number;
      },
      onStateChange: (state) => states.push(state),
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)).toBe('error');

    content = 'version-3';
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls[1]?.[0]).toEqual(save.mock.calls[0]?.[0]);

    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls[2]?.[0]).toMatchObject({
      content: 'version-3',
      expectedVersionNumber: 2,
      idempotencyKey: 'batch-2',
    });
    expect(states.at(-1)).toBe('saved');
  });

  it('leaves the saved state as soon as a new edit is pending', async () => {
    vi.useFakeTimers();
    const states: StoryOutlineAutosaveState[] = [];
    const autosave = new StoryOutlineAutosave({
      readContent: () => 'version-2',
      readExpectedVersionNumber: () => 1,
      createIdempotencyKey: () => 'batch-1',
      save: async () => ({ number: 2 }),
      onSaved: vi.fn(),
      onStateChange: (state) => states.push(state),
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)).toBe('saved');

    autosave.schedule();
    expect(states.at(-1)).toBe('pending');
  });

  it('does not publish saved while a newer edit is queued in flight', async () => {
    vi.useFakeTimers();
    const states: StoryOutlineAutosaveState[] = [];
    let resolveSave: ((value: { number: number }) => void) | null = null;
    const autosave = new StoryOutlineAutosave({
      readContent: () => 'content',
      readExpectedVersionNumber: () => 1,
      createIdempotencyKey: () => 'batch-1',
      save: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      onSaved: vi.fn(),
      onStateChange: (state) => states.push(state),
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(800);
    autosave.schedule();
    resolveSave?.({ number: 2 });
    await Promise.resolve();

    expect(states.at(-1)).toBe('pending');
  });
});
