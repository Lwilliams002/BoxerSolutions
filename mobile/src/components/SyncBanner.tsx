import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSync } from '../lib/offline';
import { colors } from '../lib/theme';

export function SyncBanner() {
  const { status, pendingCount } = useSync();
  if (status === 'online' && pendingCount === 0) return null;
  const cfg =
    status === 'offline'
      ? { text: `OFFLINE${pendingCount ? ` — ${pendingCount} pending change(s)` : ''}`, bg: colors.textMuted }
      : status === 'syncing'
        ? { text: `SYNCING — ${pendingCount} remaining`, bg: colors.accent }
        : status === 'error'
          ? { text: `SYNC ERROR — ${pendingCount} pending. Will retry.`, bg: colors.danger }
          : { text: `${pendingCount} change(s) queued`, bg: colors.info };
  return (
    <View style={[styles.banner, { backgroundColor: cfg.bg }]}>
      <Text style={styles.text}>{cfg.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 5, alignItems: 'center' },
  text: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
});
