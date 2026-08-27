import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image, TouchableOpacity, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money } from '../../src/lib/theme';
import { Loading, SectionTitle, Card, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { OwnerServiceRequest, Paginated } from '../../src/lib/types';

interface Dashboard {
  today: {
    appointments: number;
    completedStops: number;
    remainingStops: number;
    cancelled: number;
    routes: number;
    paymentsCollected: number;
    failedPayments: number;
    revenueInvoiced: number;
  };
  invoices: { outstanding: number; pastDue: number };
  upcomingAppointments: number;
  technicianActivity: { technicianName: string; completed: number; remaining: number }[];
}

const tileShadow = Platform.OS === 'web'
  ? { boxShadow: '0px 2px 6px rgba(13, 13, 13, 0.05)' }
  : {
      shadowColor: '#0D0D0D',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 6,
      elevation: 2,
    };

const actionShadow = Platform.OS === 'web'
  ? { boxShadow: '0px 3px 6px rgba(13, 13, 13, 0.12)' }
  : {
      shadowColor: '#0D0D0D',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    };

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: `${tone ?? colors.primary}18` }]}>
        <Ionicons name={icon} size={18} color={tone ?? colors.primaryDark} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { user, hasPermission } = useAuth((s) => ({ user: s.user, hasPermission: s.hasPermission }));
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isSignedIn = Boolean(user);
  const canReviewServiceRequests = hasPermission('users:write', 'appointments:write');
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    enabled: isSignedIn,
  });
  const approvals = useQuery({
    queryKey: ['dashboard-service-requests'],
    queryFn: () => api<Paginated<OwnerServiceRequest>>('/service-requests?status=submitted&page=1&pageSize=4'),
    enabled: isSignedIn && canReviewServiceRequests,
  });

  if (!isSignedIn || isLoading) return <Loading />;
  const d = data?.today;
  const done = d?.completedStops ?? 0;
  const total = (d?.completedStops ?? 0) + (d?.remainingStops ?? 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Dark brand hero */}
      <View style={[styles.hero, { paddingTop: insets.top + 10 }]}>
        <View style={styles.heroTop}>
          <Image source={require('../../assets/logo-mark.png')} style={styles.heroLogo} resizeMode="contain" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.heroBrand}>BOXER SOLUTIONS</Text>
            <Text style={styles.heroGreeting}>Hi {user?.firstName}, here's your day</Text>
          </View>
        </View>

        {/* Today progress inside hero */}
        <View style={styles.heroProgress}>
          <View style={styles.heroProgressHead}>
            <Text style={styles.heroProgressLabel}>TODAY'S STOPS</Text>
            <Text style={styles.heroProgressPct}>{done}/{total} · {pct}%</Text>
          </View>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
        </View>
      </View>

      <SyncBanner />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <SectionTitle>Today</SectionTitle>
        <View style={styles.tileGrid}>
          <StatTile icon="calendar-outline" label="Appointments" value={d?.appointments ?? 0} />
          <StatTile icon="checkmark-circle-outline" label="Completed" value={done} />
          <StatTile icon="time-outline" label="Remaining" value={d?.remainingStops ?? 0} tone={colors.warning} />
          <StatTile icon="navigate-outline" label="Routes" value={d?.routes ?? 0} tone={colors.info} />
        </View>

        <SectionTitle>Money</SectionTitle>
        <View style={styles.tileGrid}>
          <StatTile icon="cash-outline" label="Collected Today" value={money(d?.paymentsCollected)} />
          <StatTile icon="document-text-outline" label="Invoiced Today" value={money(d?.revenueInvoiced)} tone={colors.info} />
          <StatTile icon="hourglass-outline" label="Outstanding" value={money(data?.invoices.outstanding)} tone={colors.warning} />
          <StatTile icon="alert-circle-outline" label="Past Due" value={money(data?.invoices.pastDue)} tone={colors.danger} />
        </View>

        {d?.failedPayments ? (
          <View style={styles.alertBanner}>
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.alertText}>{d.failedPayments} failed payment(s) today</Text>
          </View>
        ) : null}

        {canReviewServiceRequests && approvals.data?.items?.length ? (
          <>
            <SectionTitle>Needs Approval</SectionTitle>
            <Card>
              {approvals.data.items.map((r) => (
                <View key={r.id} style={styles.approvalRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.techName}>{r.customer_name}</Text>
                    <Text style={styles.techStats} numberOfLines={1}>
                      {r.description}
                    </Text>
                    <Text style={styles.techMeta}>
                      {r.requested_at ? new Date(`${r.requested_at}`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'New request'}
                      {r.quoted_price != null ? ` · ${money(r.quoted_price)}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={r.status} />
                </View>
              ))}
              <TouchableOpacity style={styles.approvalBtn} onPress={() => router.push('/admin/service-requests')}>
                <Text style={styles.approvalBtnText}>Review all service requests</Text>
                <Ionicons name="chevron-forward" size={16} color="#0D0D0D" />
              </TouchableOpacity>
            </Card>
          </>
        ) : canReviewServiceRequests && approvals.isLoading ? (
          <>
            <SectionTitle>Needs Approval</SectionTitle>
            <Card>
              <Text style={styles.techStats}>Loading approvals...</Text>
            </Card>
          </>
        ) : canReviewServiceRequests ? (
          <>
            <SectionTitle>Needs Approval</SectionTitle>
            <Card>
              <Text style={styles.techStats}>No service requests waiting for approval.</Text>
              <TouchableOpacity style={styles.approvalBtn} onPress={() => router.push('/admin/service-requests')}>
                <Text style={styles.approvalBtnText}>Open service requests</Text>
                <Ionicons name="chevron-forward" size={16} color="#0D0D0D" />
              </TouchableOpacity>
            </Card>
          </>
        ) : null}

        <SectionTitle>Quick Actions</SectionTitle>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/routes')} activeOpacity={0.8}>
            <Ionicons name="navigate" size={22} color="#0D0D0D" />
            <Text style={styles.actionText}>Today's Route</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, styles.actionDark]}
            onPress={() => router.push('/(tabs)/schedule')}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar" size={22} color="#2DC4A2" />
            <Text style={[styles.actionText, { color: '#fff' }]}>Schedule</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroLogo: { width: 52, height: 52, borderRadius: 12 },
  heroBrand: { color: '#2DC4A2', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  heroGreeting: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', marginTop: 2 },
  heroProgress: { marginTop: 16 },
  heroProgressHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  heroProgressLabel: { color: '#8FA6A1', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroProgressPct: { color: '#2DC4A2', fontSize: 12, fontWeight: '800' },
  progressBg: { height: 8, borderRadius: 4, backgroundColor: '#242E2C' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#2DC4A2' },
  container: { padding: 16, paddingBottom: 40 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  tile: {
    width: '47%',
    marginHorizontal: '1.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    ...tileShadow,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  tileValue: { fontSize: 20, fontWeight: '900', color: colors.text },
  tileLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.danger}12`,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  alertText: { color: colors.danger, fontWeight: '700', marginLeft: 8, fontSize: 13 },
  techRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  techName: { fontSize: 15, color: colors.text, fontWeight: '600' },
  techStats: { fontSize: 14, color: colors.textMuted },
  techMeta: { fontSize: 12, color: colors.primaryDark, marginTop: 2, fontWeight: '700' },
  approvalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  approvalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  approvalBtnText: { color: colors.text, fontWeight: '900', fontSize: 13, marginRight: 6 },
  actionsRow: { flexDirection: 'row', marginHorizontal: -5 },
  action: {
    flex: 1,
    marginHorizontal: 5,
    backgroundColor: '#2DC4A2',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    ...actionShadow,
  },
  actionDark: { backgroundColor: '#0D0D0D' },
  actionText: { fontSize: 14, fontWeight: '800', color: '#0D0D0D', marginTop: 6 },
});
