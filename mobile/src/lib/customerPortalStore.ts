import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

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
    const token = await SecureStore.getItemAsync(PORTAL_TOKEN_KEY);
    set({ portalSessionToken: token, hydrated: true });
  },

  setSession: async (session) => {
    await SecureStore.setItemAsync(PORTAL_TOKEN_KEY, session.portalSessionToken);
    set({ portalSessionToken: session.portalSessionToken });
  },

  clearSession: async () => {
    await SecureStore.deleteItemAsync(PORTAL_TOKEN_KEY);
    set({ portalSessionToken: null });
  },
}));
