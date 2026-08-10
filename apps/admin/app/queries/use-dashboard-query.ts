import { useQuery } from '@tanstack/react-query';

import { getDashboardSnapshot } from '../services/mock-api.js';

export function useDashboardQuery() {
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: getDashboardSnapshot,
    staleTime: 30_000,
  });
}
