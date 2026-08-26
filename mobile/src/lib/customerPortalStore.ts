import { create } from 'zustand';
import { secureStorage } from './secureStorage';

const PORTAL_TOKEN_KEY = 'sfa_customer_portal_token';

interface CustomerPortalSession {
  portalSessionToken: string;
  expiresIn: number;
}

interface CustomerPortalState {
  portalSessionToken: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSession: (session: CustomerPortalSession) => Promise<void>;
  clearSession: () => Promise<void>;
}

export const useCustomerPortal = create<CustomerPortalState>((set) => ({
  portalSessionToken: null,
  hydrated: false,

  hydrate: async () => {
    const token = await secureStorage.getItem(PORTAL_TOKEN_KEY);
    set({ portalSessionToken: token, hydrated: true });
  },

  setSession: async (session) => {
    await secureStorage.setItem(PORTAL_TOKEN_KEY, session.portalSessionToken);
    set({ portalSessionToken: session.portalSessionToken });
  },

  clearSession: async () => {
    await secureStorage.deleteItem(PORTAL_TOKEN_KEY);
    set({ portalSessionToken: null });
  },
}));
