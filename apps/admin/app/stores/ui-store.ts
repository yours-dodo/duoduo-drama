import { create } from 'zustand';

interface AdminUiState {
  sidebarCollapsed: boolean;
  selectedTenant: string;
  toggleSidebar(): void;
  selectTenant(tenantId: string): void;
}

export const useAdminUiStore = create<AdminUiState>((set) => ({
  sidebarCollapsed: false,
  selectedTenant: 'all',
  toggleSidebar: () =>
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
    })),
  selectTenant: (tenantId) =>
    set({
      selectedTenant: tenantId,
    }),
}));
