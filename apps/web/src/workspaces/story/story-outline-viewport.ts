import type { OutlineView } from './story-outline-types';

export function shouldFitOutlineViewOnInitialization(
  lastInitializedView: OutlineView | null,
  currentView: OutlineView,
) {
  return lastInitializedView !== currentView;
}
