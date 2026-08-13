import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, fmtTime, todayISO } from '../../src/lib/theme';
import { Loading, EmptyState, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
  const days = useMemo(() => {
    const base = todayISO();
    return Array.from({ length: 14 }, (_, i) => addDays(base, i));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule', date],
    queryFn: () => api<{ items: any[] }>(`/appointments?date=${date}&pageSize=100`),
  });

  const items = (data?.items ?? []).slice().sort((a, b) => (a.windowStart < b.windowStart ? -1 : 1));

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayBar} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {days.map((d) => {
          const dt = new Date(`${d}T12:00:00`);
          const active = d === date;
          return (
            <TouchableOpacity key={d} style={[styles.day, active && styles.dayActive]} onPress={() => setDate(d)}>
              <Text style={[styles.dayName, active && styles.dayTextActive]}>
                {dt.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive]}>{dt.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={<EmptyState title="No appointments" subtitle="Nothing scheduled for this day." />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/stop/${item.id}`)}>
              <View style={styles.timeCol}>
                <Text style={styles.time}>{fmtTime(item.windowStart)}</Text>
                <Text style={styles.timeEnd}>{fmtTime(item.windowEnd)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.name}>
                    {item.customerCompany ?? `${item.customerFirstName} ${item.customerLastName}`}
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
                <Text style={styles.sub}>
                  {item.addressLine1}, {item.city}
                </Text>
                <Text style={styles.sub}>
                  {(item.services ?? []).map((s: any) => s.name).join(', ')}
                  {item.technicianName ? ` · ${item.technicianName}` : ' · Unassigned'}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dayBar: { flexGrow: 0, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8 },
  day: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, marginRight: 4 },
  dayActive: { backgroundColor: colors.primary },
  dayName: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  dayNum: { fontSize: 17, color: colors.text, fontWeight: '800' },
  dayTextActive: { color: '#0D0D0D' },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  timeCol: { width: 74, marginRight: 8 },
  time: { fontSize: 14, fontWeight: '800', color: colors.text },
  timeEnd: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1, marginRight: 6 },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
