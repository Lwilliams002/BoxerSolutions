import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, todayISO, fmtDate } from '../../src/lib/theme';
import { Loading, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { MonthWeekPicker } from '../../src/components/MonthWeekPicker';

interface RouteRow {
  id: string;
  routeDate: string;
  technicianId: string;
  technicianName: string;
  name: string | null;
  status: string;
  stopCount: number;
  completedCount: number;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RoutesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [date, setDate] = useState(todayISO());
  const weekStart = React.useMemo(() => startOfWeek(date), [date]);
  const weekEnd = React.useMemo(() => addDays(weekStart, 6), [weekStart]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['routes', weekStart],
    queryFn: () => api<{ items: RouteRow[] }>(`/routes?from=${weekStart}&to=${weekEnd}`),
  });

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const items = data?.items ?? [];
  const canCreate = hasPermission('routes:write');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Dark header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Routes</Text>
          <Text style={styles.headerSub}>
            {fmtDate(weekStart)} – {fmtDate(weekEnd)}
          </Text>
        </View>
        {canCreate && (
          <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/route/new')}>
            <Ionicons name="add" size={18} color="#0D0D0D" />
            <Text style={styles.createBtnText}>New Route</Text>
          </TouchableOpacity>
        )}
      </View>

      <MonthWeekPicker value={date} onChange={setDate} />

      <SyncBanner />

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="navigate-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTitle}>No routes for this week</Text>
              {canCreate && (
                <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/route/new')}>
                  <Ionicons name="add-circle" size={20} color="#0D0D0D" />
                  <Text style={styles.emptyActionText}>Create a Route</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const pct = item.stopCount ? Math.round((item.completedCount / item.stopCount) * 100) : 0;
            return (
              <TouchableOpacity style={styles.card} onPress={() => router.push(`/route/${item.id}`)}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{item.technicianName}</Text>
                    <Text style={styles.cardDate}>{fmtDate(item.routeDate)}</Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
                <View style={styles.progressRow}>
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{item.completedCount}/{item.stopCount}</Text>
                </View>
                <View style={styles.cardFooter}>
                  <View style={styles.pill}>
                    <Ionicons name="location-outline" size={13} color={colors.primaryDark} />
                    <Text style={styles.pillText}>{item.stopCount} stops</Text>
                  </View>
                  <View style={[styles.pill, styles.pillGo]}>
                    <Text style={styles.pillGoText}>Open Route</Text>
                    <Ionicons name="chevron-forward" size={14} color="#0D0D0D" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  headerSub: { color: '#8FA6A1', fontSize: 12, fontWeight: '700', marginTop: 2 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2DC4A2', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  createBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 14, marginLeft: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, color: colors.textMuted, fontWeight: '600', marginTop: 12 },
  emptyAction: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2DC4A2', borderRadius: 20,
    paddingVertical: 10, paddingHorizontal: 18, marginTop: 16,
  },
  emptyActionText: { color: '#0D0D0D', fontWeight: '800', fontSize: 15, marginLeft: 6 },
  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 12,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  cardName: { fontSize: 17, fontWeight: '800', color: colors.text },
  cardDate: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#2DC4A2' },
  progressText: { marginLeft: 10, fontSize: 12, fontWeight: '800', color: colors.textMuted, minWidth: 32 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg, borderRadius: 12,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  pillText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13, marginLeft: 4 },
  pillGo: { backgroundColor: '#2DC4A2' },
  pillGoText: { color: '#0D0D0D', fontWeight: '800', fontSize: 13, marginRight: 2 },
});
