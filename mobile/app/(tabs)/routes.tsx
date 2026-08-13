import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, todayISO, fmtDate } from '../../src/lib/theme';
import { Loading, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

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

export default function RoutesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [date, setDate] = useState(todayISO());
  const days = React.useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)), []);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['routes', date],
    queryFn: () => api<{ items: RouteRow[] }>(`/routes?date=${date}`),
  });

  const items = data?.items ?? [];
  const canCreate = hasPermission('routes:write');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Dark header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Routes</Text>
        {canCreate && (
          <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/route/new')}>
            <Ionicons name="add" size={18} color="#0D0D0D" />
            <Text style={styles.createBtnText}>New Route</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Date picker strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayBar}
        contentContainerStyle={{ paddingHorizontal: 14, alignItems: 'center' }}
      >
        {days.map((d) => {
          const dt = new Date(`${d}T12:00:00`);
          const active = d === date;
          return (
            <TouchableOpacity
              key={d}
              style={[styles.day, active && styles.dayActive]}
              onPress={() => setDate(d)}
            >
              <Text style={[styles.dayName, active && styles.dayTextActive]}>
                {dt.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive]}>{dt.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
              <Text style={styles.emptyTitle}>No routes for this day</Text>
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
  createBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2DC4A2', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  createBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 14, marginLeft: 4 },
  dayBar: {
    flexGrow: 0, height: 72, backgroundColor: '#111', paddingVertical: 8,
  },
  day: {
    height: 56, minWidth: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11,
    borderRadius: 12, marginRight: 6,
  },
  dayActive: { backgroundColor: '#2DC4A2' },
  dayName: { fontSize: 11, lineHeight: 15, color: '#6B7C78', fontWeight: '700' },
  dayNum: { fontSize: 18, lineHeight: 23, color: '#fff', fontWeight: '900', marginTop: 1 },
  dayTextActive: { color: '#0D0D0D' },
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
