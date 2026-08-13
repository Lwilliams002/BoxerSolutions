import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money } from '../../src/lib/theme';
import { Card, SectionTitle, Loading, Button } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

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

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const user = useAuth((s) => s.user);
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
  });

  if (isLoading) return <Loading />;
  const d = data?.today;

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      {/* Brand header strip */}
      <View style={styles.brandHeader}>
        <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <View>
          <Text style={styles.headerTitle}>BOXER SOLUTIONS</Text>
          <Text style={styles.headerSub}>PEST CONTROL</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <Text style={styles.greeting}>
          Welcome back, {user?.firstName}
        </Text>

        <SectionTitle>Today</SectionTitle>
        <Card>
          <View style={styles.statGrid}>
            <Stat label="Appointments" value={d?.appointments ?? 0} />
            <Stat label="Completed" value={d?.completedStops ?? 0} tone={colors.success} />
            <Stat label="Remaining" value={d?.remainingStops ?? 0} tone={colors.warning} />
            <Stat label="Routes" value={d?.routes ?? 0} />
          </View>
        </Card>

        <SectionTitle>Money</SectionTitle>
        <Card>
          <View style={styles.statGrid}>
            <Stat label="Collected Today" value={money(d?.paymentsCollected)} tone={colors.success} />
            <Stat label="Invoiced Today" value={money(d?.revenueInvoiced)} />
            <Stat label="Outstanding" value={money(data?.invoices.outstanding)} tone={colors.warning} />
            <Stat label="Past Due" value={money(data?.invoices.pastDue)} tone={colors.danger} />
          </View>
          {d?.failedPayments ? (
            <Text style={styles.alert}>⚠ {d.failedPayments} failed payment(s) today</Text>
          ) : null}
        </Card>

        {data?.technicianActivity?.length ? (
          <>
            <SectionTitle>Technician Activity</SectionTitle>
            <Card>
              {data.technicianActivity.map((t, i) => (
                <View key={i} style={styles.techRow}>
                  <Text style={styles.techName}>{t.technicianName}</Text>
                  <Text style={styles.techStats}>
                    {t.completed} done · {t.remaining} left
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle>Quick Actions</SectionTitle>
        <Button title="Today's Route" onPress={() => router.push('/(tabs)/routes')} />
        <Button title="View Schedule" variant="outline" onPress={() => router.push('/(tabs)/schedule')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerLogo: { width: 48, height: 48, marginRight: 10 },
  headerTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  headerSub: { color: '#2DC4A2', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  container: { padding: 16, paddingBottom: 40 },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', paddingVertical: 10 },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  alert: { color: colors.danger, fontWeight: '600', marginTop: 8 },
  techRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  techName: { fontSize: 15, color: colors.text, fontWeight: '600' },
  techStats: { fontSize: 14, color: colors.textMuted },
});
