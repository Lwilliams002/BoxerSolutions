import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, todayISO, fmtDate } from '../../src/lib/theme';
import { Loading, EmptyState, StatusBadge } from '../../src/components/ui';
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

export default function RoutesScreen() {
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['routes', todayISO()],
    queryFn: () => api<{ items: RouteRow[] }>(`/routes?date=${todayISO()}`),
  });

  if (isLoading) return <Loading />;
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={<EmptyState title="No routes today" subtitle="Routes assigned to you will appear here." />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/route/${item.id}`)}>
            <View style={styles.header}>
              <Text style={styles.title}>{item.name ?? `Route — ${item.technicianName}`}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.sub}>{fmtDate(item.routeDate)} · {item.technicianName}</Text>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${item.stopCount ? (item.completedCount / item.stopCount) * 100 : 0}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {item.completedCount}/{item.stopCount} stops
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  progressBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
  progressText: { marginLeft: 10, fontSize: 12, color: colors.textMuted, fontWeight: '600' },
});
