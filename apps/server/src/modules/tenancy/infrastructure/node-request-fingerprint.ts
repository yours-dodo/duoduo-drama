import { createHash } from 'node:crypto';

export class NodeRequestFingerprint {
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
