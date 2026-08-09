export interface KeysetCursor {
  at: Date;
  id: string;
}

export interface KeysetPageRequest {
  limit: number;
  after: KeysetCursor | null;
}

export interface KeysetPage<T> {
  items: T[];
  next: KeysetCursor | null;
}
