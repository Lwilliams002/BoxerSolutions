import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';

/**
 * Native push registration (iOS/Android builds only). The web build and Expo
 * Go are skipped: they cannot receive remote pushes, and the in-app
 * Notifications screen still lists everything.
 */
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
let registeredToken: string | null = null;

type NotificationsModule = typeof import('expo-notifications');
type DeviceModule = typeof import('expo-device');

function loadModules(): { Notifications: NotificationsModule; Device: DeviceModule } | null {
  if (!isNative) return null;
  try {
    // Required lazily so the web bundle never evaluates the native module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications') as NotificationsModule;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device') as DeviceModule;
    return { Notifications, Device };
  } catch {
    return null;
  }
}

/** Show pushes as banners even while the app is in the foreground. */
export function configurePushHandling() {
  const mods = loadModules();
  if (!mods) return;
  mods.Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission, fetch the Expo token, and register it with the API. Safe to call repeatedly. */
export async function registerForPushNotifications(): Promise<string | null> {
  const mods = loadModules();
  if (!mods) return null;
  const { Notifications, Device } = mods;
  if (!Device.isDevice) return null; // simulators have no push token
  if (Constants.appOwnership === 'expo') return null; // Expo Go cannot receive remote pushes

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Office alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2DC4A2',
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token) return null;
    await api('/notifications/push-token', {
      method: 'POST',
      body: { token, platform: Platform.OS, deviceName: Device.deviceName ?? Device.modelName ?? null },
    });
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

/** Forget this device's token on sign-out so the next user doesn't get the office's alerts. */
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await api('/notifications/push-token', { method: 'DELETE', body: { token } });
  } catch {
    // best effort
  }
}

/** Route to open when a notification is tapped, from its data payload. */
export function pushTargetRoute(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  if (typeof data.customerId === 'string' && data.customerId) return `/customer/${data.customerId}`;
  if (typeof data.invoiceId === 'string' && data.invoiceId) return `/invoice/${data.invoiceId}`;
  if (typeof data.appointmentId === 'string' && data.appointmentId) return `/appointment/${data.appointmentId}`;
  return '/notifications';
}

/** Open the right screen when the user taps a push (cold start or background). */
export function subscribeToPushTaps(navigate: (route: string) => void): () => void {
  const mods = loadModules();
  if (!mods) return () => {};
  const { Notifications } = mods;
  const handle = (response: { notification: { request: { content: { data?: Record<string, unknown> } } } } | null) => {
    const route = pushTargetRoute(response?.notification.request.content.data);
    if (route) navigate(route);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) handle(r); }).catch(() => {});
  return () => sub.remove();
}
