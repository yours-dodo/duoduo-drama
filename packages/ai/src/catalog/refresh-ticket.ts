import type { CatalogRefreshTicket } from './catalog-store.js';

export function compareRefreshTickets(
  left: CatalogRefreshTicket,
  right: CatalogRefreshTicket,
): number {
  const a = BigInt(left.refreshGeneration);
  const b = BigInt(right.refreshGeneration);
  return a < b ? -1 : a > b ? 1 : 0;
}
