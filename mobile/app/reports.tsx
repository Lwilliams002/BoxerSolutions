import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { colors, fmtDate, money, statusColors, statusLabel, todayISO } from '../src/lib/theme';
import { Card, EmptyState, Label, Loading, Row, SectionTitle, Value } from '../src/components/ui';
import { SyncBanner } from '../src/components/SyncBanner';

interface Technician { employeeId: string; firstName: string; lastName: string; color: string | null }
interface RevenueReport { totalInvoiced: number; totalCollected: number; totalRefunded: number; outstanding: number; series: { date: string; invoiced: number; collected: number }[] }
interface TechnicianPerformance { technicians: { technicianId: string; technicianName: string; completedAppointments: number; cancelledAppointments: number; completionRate: number; revenueCollected: number; avgPerJob: number }[] }
interface AppointmentReport { statusCounts: { status: string; count: number }[]; series: { date: string; completed: number; cancelled: number }[] }
interface ArAgingReport { buckets: { current: number; oneToThirty: number; thirtyOneToSixty: number; sixtyOneToNinety: number; overNinety: number; total: number }; topBalances: { customerId: string; customerName: string; balance: number; oldestDueDate: string; invoiceCount: number }[] }
interface RecurringReport { active: number; paused: number; cancelled: number; mrrEstimate: number; upcomingAppointmentCount: number; statusCounts: { status: string; count: number }[] }
interface CustomerGrowthReport { active: number; inactive: number; newThisPeriod: number; series: { week: string; newCustomers: number }[] }

type PresetKey = '7d' | '30d' | 'thisMonth' | 'lastMonth';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeForPreset(key: PresetKey) {
  const now = new Date(`${todayISO()}T12:00:00`);
  if (key === '7d' || key === '30d') {
    const from = new Date(now);
    from.setDate(from.getDate() - (key === '7d' ? 6 : 29));
    return { from: iso(from), to: iso(now) };
  }
  if (key === 'thisMonth') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
}

function reportPath(endpoint: string, from: string, to: string, technicianId: string | null) {
  const tech = technicianId ? `&technicianId=${encodeURIComponent(technicianId)}` : '';
  return `/reports/${endpoint}?from=${from}&to=${to}${tech}`;
}

function StatTile({ label, value, tone = colors.primaryDark }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statTile}>
      <Label>{label}</Label>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
    </View>
  );
}

function MiniBars({ data, valueKey, labelKey, color = colors.primary }: { data: Record<string, unknown>[]; valueKey: string; labelKey: string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey] ?? 0)));
  return (
    <View style={styles.chart}>
      {data.map((d) => {
        const value = Number(d[valueKey] ?? 0);
        const width = `${Math.max(3, (value / max) * 100)}%` as `${number}%`;
        return (
          <View key={String(d[labelKey])} style={styles.barRow}>
            <Text style={styles.barLabel}>{fmtDate(String(d[labelKey]))}</Text>
            <View style={styles.barTrack}><View style={[styles.barFill, { width, backgroundColor: color }]} /></View>
            <Text style={styles.barValue}>{valueKey.toLowerCase().includes('customer') ? value : money(value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ReportsScreen() {
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const { from, to } = useMemo(() => rangeForPreset(preset), [preset]);
  const querySuffix = [from, to, technicianId];

  const techQuery = useQuery({ queryKey: ['technicians'], queryFn: () => api<Technician[]>('/users/technicians') });
  const revenueQuery = useQuery({ queryKey: ['reports', 'revenue', ...querySuffix], queryFn: () => api<RevenueReport>(reportPath('revenue', from, to, technicianId)) });
  const performanceQuery = useQuery({ queryKey: ['reports', 'technician-performance', ...querySuffix], queryFn: () => api<TechnicianPerformance>(reportPath('technician-performance', from, to, technicianId)) });
  const appointmentQuery = useQuery({ queryKey: ['reports', 'appointments', ...querySuffix], queryFn: () => api<AppointmentReport>(reportPath('appointments', from, to, technicianId)) });
  const arQuery = useQuery({ queryKey: ['reports', 'ar-aging'], queryFn: () => api<ArAgingReport>(reportPath('ar-aging', from, to, null)) });
  const recurringQuery = useQuery({ queryKey: ['reports', 'recurring', ...querySuffix], queryFn: () => api<RecurringReport>(reportPath('recurring', from, to, technicianId)) });
  const growthQuery = useQuery({ queryKey: ['reports', 'customer-growth', from, to], queryFn: () => api<CustomerGrowthReport>(reportPath('customer-growth', from, to, null)) });

  const queries = [techQuery, revenueQuery, performanceQuery, appointmentQuery, arQuery, recurringQuery, growthQuery];
  const loading = queries.some((q) => q.isLoading);
  const refreshing = queries.some((q) => q.isRefetching);
  const error = queries.find((q) => q.error)?.error as Error | undefined;
  const revenue = revenueQuery.data;
  const performance = performanceQuery.data;
  const appointments = appointmentQuery.data;
  const ar = arQuery.data;
  const recurring = recurringQuery.data;
  const growth = growthQuery.data;

  const refresh = () => { void Promise.all(queries.map((q) => q.refetch())); };

  if (loading) return <Loading />;

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <Text style={styles.title}>Reports</Text>
        <Text style={styles.subtitle}>{fmtDate(from)} – {fmtDate(to)}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          {PRESETS.map((p) => (
            <TouchableOpacity key={p.key} onPress={() => setPreset(p.key)} style={[styles.chip, preset === p.key && styles.chipActive]} activeOpacity={0.75}>
              <Text style={[styles.chipText, preset === p.key && styles.chipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.techScroll} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity onPress={() => setTechnicianId(null)} style={[styles.chip, technicianId === null && styles.chipActive]} activeOpacity={0.75}>
            <Text style={[styles.chipText, technicianId === null && styles.chipTextActive]}>All techs</Text>
          </TouchableOpacity>
          {(techQuery.data ?? []).map((t) => (
            <TouchableOpacity key={t.employeeId} onPress={() => setTechnicianId(t.employeeId)} style={[styles.chip, technicianId === t.employeeId && styles.chipActive]} activeOpacity={0.75}>
              <Text style={[styles.chipText, technicianId === t.employeeId && styles.chipTextActive]}>{t.firstName} {t.lastName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {error ? <EmptyState title="Unable to load reports" subtitle={error.message} /> : null}

        <SectionTitle>Revenue Summary</SectionTitle>
        <Card>
          <View style={styles.grid}>
            <StatTile label="Collected" value={money(revenue?.totalCollected)} />
            <StatTile label="Invoiced" value={money(revenue?.totalInvoiced)} />
            <StatTile label="Outstanding" value={money(revenue?.outstanding)} tone={colors.warning} />
            <StatTile label="Refunded" value={money(revenue?.totalRefunded)} tone={colors.danger} />
          </View>
          {(revenue?.series ?? []).length ? <MiniBars data={revenue!.series.slice(-14)} valueKey="collected" labelKey="date" /> : <EmptyState title="No revenue in range" />}
        </Card>

        <SectionTitle>Technician Leaderboard</SectionTitle>
        <Card>
          {(performance?.technicians ?? []).length ? performance!.technicians.map((t) => (
            <View key={t.technicianId} style={styles.listRow}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{t.technicianName}</Text>
                <Text style={styles.meta}>{t.completedAppointments} completed • {t.completionRate}% completion</Text>
              </View>
              <Text style={styles.amount}>{money(t.revenueCollected)}</Text>
            </View>
          )) : <EmptyState title="No technician data" />}
        </Card>

        <SectionTitle>Appointment Stats</SectionTitle>
        <Card>
          <View style={styles.statusWrap}>
            {(appointments?.statusCounts ?? []).map((s) => {
              const color = statusColors[s.status] ?? colors.textMuted;
              return <View key={s.status} style={[styles.statusChip, { backgroundColor: `${color}22` }]}><Text style={[styles.statusText, { color }]}>{statusLabel(s.status)}: {s.count}</Text></View>;
            })}
          </View>
          {(appointments?.series ?? []).length ? <MiniBars data={appointments!.series.slice(-14)} valueKey="completed" labelKey="date" color={colors.success} /> : null}
        </Card>

        <SectionTitle>AR Aging</SectionTitle>
        <Card>
          {[['Current', ar?.buckets.current], ['1–30', ar?.buckets.oneToThirty], ['31–60', ar?.buckets.thirtyOneToSixty], ['61–90', ar?.buckets.sixtyOneToNinety], ['90+', ar?.buckets.overNinety]].map(([label, value]) => (
            <Row key={String(label)} style={styles.metricRow}><Value>{label}</Value><Value style={{ fontWeight: '800' }}>{money(value as number)}</Value></Row>
          ))}
          <Row style={styles.metricRow}><Value style={{ fontWeight: '900' }}>Total</Value><Value style={{ fontWeight: '900', color: colors.warning }}>{money(ar?.buckets.total)}</Value></Row>
          {(ar?.topBalances ?? []).map((c) => (
            <View key={c.customerId} style={styles.listRow}>
              <View style={styles.rowMain}><Text style={styles.rowTitle}>{c.customerName}</Text><Text style={styles.meta}>{c.invoiceCount} invoices • oldest {fmtDate(c.oldestDueDate)}</Text></View>
              <Text style={styles.amount}>{money(c.balance)}</Text>
            </View>
          ))}
        </Card>

        <SectionTitle>Recurring</SectionTitle>
        <Card>
          <View style={styles.grid}>
            <StatTile label="MRR Estimate" value={money(recurring?.mrrEstimate)} />
            <StatTile label="Active Plans" value={String(recurring?.active ?? 0)} />
            <StatTile label="Paused" value={String(recurring?.paused ?? 0)} tone={colors.warning} />
            <StatTile label="Upcoming Visits" value={String(recurring?.upcomingAppointmentCount ?? 0)} />
          </View>
        </Card>

        <SectionTitle>Customer Growth</SectionTitle>
        <Card>
          <View style={styles.grid}>
            <StatTile label="New This Period" value={String(growth?.newThisPeriod ?? 0)} />
            <StatTile label="Active" value={String(growth?.active ?? 0)} />
            <StatTile label="Inactive" value={String(growth?.inactive ?? 0)} tone={colors.textMuted} />
          </View>
          {(growth?.series ?? []).length ? <MiniBars data={growth!.series} valueKey="newCustomers" labelKey="week" color={colors.primaryDark} /> : null}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.textMuted, marginTop: 4, marginBottom: 8, fontSize: 13 },
  filterScroll: { height: 46, marginVertical: 4 },
  techScroll: { height: 46, marginBottom: 8 },
  filterContent: { height: 46, alignItems: 'center', gap: 8, paddingRight: 16 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, justifyContent: 'center' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.primaryDark, fontWeight: '800', lineHeight: 18 },
  chipTextActive: { color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: { width: '48%', padding: 12, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  chart: { marginTop: 14, gap: 8 },
  barRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 64, fontSize: 11, color: colors.textMuted, lineHeight: 14 },
  barTrack: { flex: 1, height: 12, borderRadius: 8, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 8 },
  barValue: { width: 68, fontSize: 11, color: colors.textMuted, textAlign: 'right', lineHeight: 14 },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: 10 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  amount: { fontSize: 14, fontWeight: '900', color: colors.primaryDark },
  statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 12, fontWeight: '800' },
  metricRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
