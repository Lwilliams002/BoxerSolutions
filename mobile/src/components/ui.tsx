import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, statusColors, statusLabel } from '../lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === 'primary' ? colors.primary
    : variant === 'danger' ? colors.danger
    : variant === 'success' ? colors.success
    : variant === 'secondary' ? colors.accent
    : 'transparent';
  // Brand pairing: black text on teal, white text on black/danger
  const fg =
    variant === 'outline' ? colors.primaryDark
    : variant === 'primary' || variant === 'success' ? '#0D0D0D'
    : '#FFFFFF';
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={[
        styles.button,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1.5, borderColor: colors.primary, shadowOpacity: 0, elevation: 0 },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] ?? statusColors[status.toLowerCase()] ?? colors.textMuted;
  return (
    <View style={[styles.badge, { backgroundColor: `${c}22` }]}>
      <Text style={[styles.badgeText, { color: c }]}>{statusLabel(status)}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Value({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.value, style]}>{children}</Text>;
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function ErrorText({ message }: { message: string }) {
  return <Text style={styles.errorText}>{message}</Text>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  button: {
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 5,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontSize: 15, color: colors.text },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textMuted },
  emptySubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
  errorText: { color: colors.danger, marginVertical: 8, textAlign: 'center' },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 10,
  },
});
