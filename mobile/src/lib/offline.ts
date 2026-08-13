import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import { api, newIdempotencyKey, ApiRequestError, RequestOptions } from './api';
import { uploadPendingPhoto, PendingPhoto } from './photos';

const QUEUE_KEY = 'sfa_offline_queue';

export interface QueuedMutation {
  id: string;
  kind: 'api' | 'photo';
  createdAt: string;
  attempts: number;
  lastError?: string;
  // kind=api
  path?: string;
  options?: Omit<RequestOptions, 'retry'>;
  // kind=photo
  photo?: PendingPhoto;
}

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  init: () => void;
  enqueueApi: (path: string, options: Omit<RequestOptions, 'retry' | 'idempotencyKey'>) => Promise<void>;
  enqueuePhoto: (photo: PendingPhoto) => Promise<void>;
  flush: () => Promise<void>;
}

async function loadQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(q: QueuedMutation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

let flushing = false;

export const useSync = create<SyncState>((set, get) => ({
  status: 'online',
  pendingCount: 0,

  init: () => {
    loadQueue().then((q) => set({ pendingCount: q.length }));
    NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        if (get().status === 'offline') set({ status: 'online' });
        void get().flush();
      } else {
        set({ status: 'offline' });
      }
    });
  },

  enqueueApi: async (path, options) => {
    const q = await loadQueue();
    q.push({
      id: newIdempotencyKey(),
      kind: 'api',
      createdAt: new Date().toISOString(),
      attempts: 0,
      path,
      options,
    });
    await saveQueue(q);
    set({ pendingCount: q.length });
    void get().flush();
  },

  enqueuePhoto: async (photo) => {
    const q = await loadQueue();
    q.push({ id: newIdempotencyKey(), kind: 'photo', createdAt: new Date().toISOString(), attempts: 0, photo });
    await saveQueue(q);
    set({ pendingCount: q.length });
    void get().flush();
  },

  flush: async () => {
    if (flushing) return;
    flushing = true;
    try {
      let q = await loadQueue();
      if (q.length === 0) {
        set({ status: 'online', pendingCount: 0 });
        return;
      }
      const net = await NetInfo.fetch();
      if (!net.isConnected) {
        set({ status: 'offline', pendingCount: q.length });
        return;
      }
      set({ status: 'syncing' });
      while (q.length > 0) {
        const item = q[0];
        try {
          if (item.kind === 'api') {
            // Idempotency key = queue item id → replay-safe across retries.
            await api(item.path!, { ...item.options, idempotencyKey: item.id });
          } else if (item.kind === 'photo') {
            await uploadPendingPhoto(item.photo!);
          }
          q.shift();
          await saveQueue(q);
          set({ pendingCount: q.length });
        } catch (e) {
          const err = e as ApiRequestError;
          if (err.status === 0 || err.retryable) {
            // network / transient failure — stop and retry later
            item.attempts += 1;
            item.lastError = err.message;
            await saveQueue(q);
            set({ status: err.status === 0 ? 'offline' : 'error', pendingCount: q.length });
            return;
          }
          // permanent failure (validation/authorization) — drop to avoid poison-pill blocking
          q.shift();
          await saveQueue(q);
          set({ pendingCount: q.length });
        }
      }
      set({ status: 'online', pendingCount: 0 });
    } finally {
      flushing = false;
    }
  },
}));

/**
 * Perform a mutation online if possible; queue it when offline or on network failure.
 * Returns { queued: true } when deferred.
 */
export async function mutateOrQueue<T = unknown>(
  path: string,
  options: Omit<RequestOptions, 'retry'>,
): Promise<{ queued: boolean; data?: T }> {
  try {
    const data = await api<T>(path, { ...options, idempotencyKey: options.idempotencyKey ?? newIdempotencyKey() });
    return { queued: false, data };
  } catch (e) {
    const err = e as ApiRequestError;
    if (err.status === 0) {
      await useSync.getState().enqueueApi(path, options);
      return { queued: true };
    }
    throw e;
  }
}
