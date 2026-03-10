import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "GM" | "CONTROLLER" | "CFO" | "AP_CLERK" | "AR_CLERK" | "ADMIN" | "SUPERADMIN";

interface AppState {
  // Entity / chain context
  activeEntityId: string | null;
  activeChainId: string | null;
  setActiveEntity: (entityId: string, chainId: string) => void;

  // User / role
  userId: string | null;
  userEmail: string | null;
  roles: UserRole[];
  setUser: (userId: string, email: string, roles: UserRole[]) => void;

  // Dashboard view
  dashboardView: "GM" | "CONTROLLER" | "CFO";
  setDashboardView: (view: "GM" | "CONTROLLER" | "CFO") => void;

  // UI state
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Active fiscal period
  activePeriodId: string | null;
  activePeriodLabel: string | null;
  setActivePeriod: (id: string, label: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeEntityId: null,
      activeChainId: null,
      setActiveEntity: (entityId, chainId) => set({ activeEntityId: entityId, activeChainId: chainId }),

      userId: null,
      userEmail: null,
      roles: [],
      setUser: (userId, email, roles) => set({ userId, userEmail: email, roles }),

      dashboardView: "GM",
      setDashboardView: (view) => set({ dashboardView: view }),

      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      activePeriodId: null,
      activePeriodLabel: null,
      setActivePeriod: (id, label) => set({ activePeriodId: id, activePeriodLabel: label }),
    }),
    {
      name: "hfp-app-store",
      partialize: (state) => ({
        activeEntityId: state.activeEntityId,
        activeChainId: state.activeChainId,
        dashboardView: state.dashboardView,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
