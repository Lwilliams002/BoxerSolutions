import { create } from 'zustand';
import { SessionUser } from './types';
import { API_URL } from './config';
import { secureStorage } from './secureStorage';

const ACCESS_KEY = 'sfa_access_token';
const REFRESH_KEY = 'sfa_refresh_token';
const USER_KEY = 'sfa_user';

interface AuthState {
  user: SessionUser | null;
  accessToken: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (access: string, refresh: string) => Promise<void>;
  getRefreshToken: () => Promise<string | null>;
  hasPermission: (...perms: string[]) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const [access, userJson] = await Promise.all([
        secureStorage.getItem(ACCESS_KEY),
        secureStorage.getItem(USER_KEY),
      ]);
      set({
        accessToken: access,
        user: userJson ? JSON.parse(userJson) : null,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  login: async (email, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message ?? 'Login failed');
    const { accessToken, refreshToken, user } = json.data;
    await Promise.all([
      secureStorage.setItem(ACCESS_KEY, accessToken),
      secureStorage.setItem(REFRESH_KEY, refreshToken),
      secureStorage.setItem(USER_KEY, JSON.stringify(user)),
    ]);
    set({ accessToken, user });
  },

  logout: async () => {
    const refresh = await secureStorage.getItem(REFRESH_KEY);
    const access = get().accessToken;
    try {
      if (refresh) {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(access ? { Authorization: `Bearer ${access}` } : {}),
          },
          body: JSON.stringify({ refreshToken: refresh }),
        });
      }
    } catch {
      // best-effort server-side revocation
    }
    await Promise.all([
      secureStorage.deleteItem(ACCESS_KEY),
      secureStorage.deleteItem(REFRESH_KEY),
      secureStorage.deleteItem(USER_KEY),
    ]);
    set({ accessToken: null, user: null });
  },

  setTokens: async (access, refresh) => {
    await Promise.all([
      secureStorage.setItem(ACCESS_KEY, access),
      secureStorage.setItem(REFRESH_KEY, refresh),
    ]);
    set({ accessToken: access });
  },

  getRefreshToken: () => secureStorage.getItem(REFRESH_KEY),

  hasPermission: (...perms) => {
    const user = get().user;
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return perms.some((p) => user.permissions.includes(p));
  },
}));
