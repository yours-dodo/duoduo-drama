import { createHash } from 'node:crypto';
import type { JsonValue } from '../core/content.js';

export function digestCatalogPayload(payload: JsonValue): string {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url');
}
