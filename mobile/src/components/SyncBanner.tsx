import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSync } from '../lib/offline';
import { colors } from '../lib/theme';

export function SyncBanner() {
  const { status, pendingCount } = useSync();
  if (status === 'online' && pendingCount === 0) return null;
  const cfg =
    status === 'offline'
      ? { text: `OFFLINE${pendingCount ? ` — ${pendingCount} pending change(s)` : ''}`, bg: '#4A5A56', fg: '#fff' }
      : status === 'syncing'
        ? { text: `SYNCING — ${pendingCount} remaining`, bg: colors.primary, fg: '#0D0D0D' }
        : status === 'error'
          ? { text: `SYNC ERROR — ${pendingCount} pending. Will retry.`, bg: colors.danger, fg: '#fff' }
          : { text: `${pendingCount} change(s) queued`, bg: colors.info, fg: '#fff' };
  return (
    <View style={[styles.banner, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.fg }]}>{cfg.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 5, alignItems: 'center' },
  text: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
});
