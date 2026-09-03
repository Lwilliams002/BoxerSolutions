import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 *
 * React Native's Alert.alert with buttons is a silent no-op on web — the
 * dialog never appears and button callbacks never fire. This helper uses
 * window.confirm on web and Alert.alert on iOS/Android.
 */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const { title, message, confirmText, destructive, onConfirm } = options;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
    if (ok) void onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => void onConfirm() },
  ]);
}

/** Cross-platform informational alert (single OK button). */
export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

