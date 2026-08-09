const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface IssueSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  issuedAt: Date;
}

export interface SessionSnapshot {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class Session {
  private constructor(private readonly snapshot: SessionSnapshot) {}

  static issue(input: IssueSessionInput): Session {
    const createdAt = new Date(input.issuedAt);

    return new Session({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
      revokedAt: null,
    });
  }

  isActive(at: Date): boolean {
    return (
      this.snapshot.revokedAt === null &&
      at.getTime() < this.snapshot.expiresAt.getTime()
    );
  }

  revoke(at: Date): boolean {
    if (this.snapshot.revokedAt !== null) {
      return false;
    }

    this.snapshot.revokedAt = new Date(at);
    return true;
  }

  toSnapshot(): SessionSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      expiresAt: new Date(this.snapshot.expiresAt),
      revokedAt:
        this.snapshot.revokedAt === null
          ? null
          : new Date(this.snapshot.revokedAt),
    };
  }
}
