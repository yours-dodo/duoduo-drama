import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminSessionState {
  isAuthenticated: boolean;
  displayName: string;
  login(): void;
  logout(): void;
}

export const useAdminSessionStore = create<AdminSessionState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      displayName: 'Admin Operator',
      login: () =>
        set({
          isAuthenticated: true,
        }),
      logout: () =>
        set({
          isAuthenticated: false,
        }),
    }),
    {
      name: 'duoduo-admin-session',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        displayName: state.displayName,
      }),
    },
  ),
);
