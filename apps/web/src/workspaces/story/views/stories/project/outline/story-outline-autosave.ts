export type StoryOutlineAutosaveState =
  'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type StoryOutlineAutosaveBatch = {
  content: string;
  expectedVersionNumber: number;
  idempotencyKey: string;
};

export type StoryOutlineAutosaveOptions<TVersion> = {
  delayMs?: number;
  readContent: () => string | null;
  readExpectedVersionNumber: () => number;
  createIdempotencyKey: () => string;
  save: (batch: StoryOutlineAutosaveBatch) => Promise<TVersion>;
  onSaved: (version: TVersion) => void;
  onStateChange?: (state: StoryOutlineAutosaveState) => void;
};

export class StoryOutlineAutosave<TVersion> {
  private readonly delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private saving = false;
  private disposed = false;
  private failedBatch: StoryOutlineAutosaveBatch | null = null;

  constructor(private readonly options: StoryOutlineAutosaveOptions<TVersion>) {
    this.delayMs = options.delayMs ?? 800;
  }

  schedule(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.failedBatch) this.options.onStateChange?.('pending');
    this.armTimer();
  }

  retry(): void {
    if (this.disposed || !this.failedBatch) return;
    this.armTimer(0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async flushNow(): Promise<void> {
    if (this.disposed || this.saving) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;

    const batch = this.failedBatch ?? this.createBatch();
    if (!batch) return;
    if (!this.failedBatch) this.dirty = false;

    this.saving = true;
    this.options.onStateChange?.('saving');
    try {
      const version = await this.options.save(batch);
      this.failedBatch = null;
      this.options.onSaved(version);
      this.options.onStateChange?.(this.dirty ? 'pending' : 'saved');
    } catch {
      this.failedBatch = batch;
      this.options.onStateChange?.('error');
    } finally {
      this.saving = false;
      if (this.dirty && !this.failedBatch) this.armTimer();
    }
  }

  private createBatch(): StoryOutlineAutosaveBatch | null {
    if (!this.dirty) return null;
    const content = this.options.readContent();
    if (content === null) return null;
    return {
      content,
      expectedVersionNumber: this.options.readExpectedVersionNumber(),
      idempotencyKey: this.options.createIdempotencyKey(),
    };
  }

  private armTimer(delayMs = this.delayMs): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, delayMs);
  }
}
