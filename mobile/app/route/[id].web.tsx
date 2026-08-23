import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { mutateOrQueue } from '../../src/lib/offline';
import { colors, fmtTime, money } from '../../src/lib/theme';
import { Loading, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

interface Stop {
  stopId: string;
  stopOrder: number;
  estimatedArrival: string | null;
  appointmentId: string;
  status: string;
  windowStart: string;
  windowEnd: string;
  customerId: string;
  customerName: string;
  company: string | null;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  services: { name: string; unitPrice: number; quantity: number }[];
  estimatedTotal: string;
}

interface RouteDetail {
  id: string;
  technicianName: string;
  status: string;
  stops: Stop[];
  stopCount: number;
  completedCount: number;
}

const COMPLETED_STATUSES = ['completed', 'cancelled', 'no_access'];

export function openNavigation(lat: number, lng: number, _label: string) {
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {
    Alert.alert('Unable to open maps', 'Please copy the address into your preferred map app.');
  });
}

export default function RouteDetailScreenWeb() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [routeStarted, setRouteStarted] = useState(false);
  const [activeStopIdx, setActiveStopIdx] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['route', id],
    queryFn: () => api<RouteDetail>(`/routes/${id}`),
    refetchInterval: routeStarted ? 15000 : false,
  });

  const optimize = useMutation({
    mutationFn: () => api(`/routes/${id}/optimize`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['route', id] }),
  });

  const updateStopStatus = useMutation({
    mutationFn: async ({ appointmentId, status }: { appointmentId: string; status: string }) => {
      const { queued } = await mutateOrQueue(`/appointments/${appointmentId}/status`, {
        method: 'POST',
        body: { status },
      });
      return { queued, appointmentId, status };
    },
    onSuccess: ({ appointmentId, status }) => {
      qc.setQueryData(['route', id], (prev: RouteDetail | undefined) =>
        prev
          ? {
              ...prev,
              stops: prev.stops.map((s) => (s.appointmentId === appointmentId ? { ...s, status } : s)),
            }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: ['route', id] });
      void qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => Alert.alert('Error', (e as Error).message),
  });

  const stops = data?.stops ?? [];
  const pendingStops = useMemo(() => stops.filter((s) => !COMPLETED_STATUSES.includes(s.status)), [stops]);
  const activeStop = routeStarted ? (pendingStops[activeStopIdx] ?? null) : null;
  const done = data?.completedCount ?? 0;
  const total = data?.stopCount ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (isLoading || !data) return <Loading />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#2DC4A2" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{data.technicianName}</Text>
          <Text style={styles.headerSub}>{total} stops · {done} done</Text>
        </View>
        <TouchableOpacity style={styles.optBtn} onPress={() => optimize.mutate()} disabled={optimize.isPending}>
          <Ionicons name="git-network-outline" size={15} color="#0D0D0D" />
          <Text style={styles.optText}>{optimize.isPending ? 'Optimizing…' : 'Optimize'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressWrap}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressPct}>{pct}%</Text>
      </View>

      <SyncBanner />

      {!routeStarted ? (
        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => {
            if (pendingStops.length === 0) {
              Alert.alert('All done!', 'No pending stops on this route.');
              return;
            }
            setRouteStarted(true);
            setActiveStopIdx(0);
          }}
        >
          <Ionicons name="play" size={18} color="#0D0D0D" />
          <Text style={styles.startBtnText}>Start Route</Text>
        </TouchableOpacity>
      ) : activeStop ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeLabel}>CURRENT STOP</Text>
          <Text style={styles.activeName}>{activeStop.company ?? activeStop.customerName}</Text>
          <Text style={styles.activeAddr}>{activeStop.addressLine1}, {activeStop.city}</Text>
          <View style={styles.activeActions}>
            {activeStop.latitude != null && activeStop.longitude != null ? (
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() =>
                  openNavigation(activeStop.latitude!, activeStop.longitude!, activeStop.company ?? activeStop.customerName)
                }
              >
                <Ionicons name="navigate" size={18} color="#0D0D0D" />
                <Text style={styles.navBtnText}>Navigate</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.openBtn} onPress={() => router.push(`/stop/${activeStop.appointmentId}`)}>
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.openBtnText}>Open Stop</Text>
            </TouchableOpacity>
            {(activeStop.status === 'scheduled' || activeStop.status === 'en_route') && (
              <TouchableOpacity
                style={styles.arriveBtn}
                onPress={() => updateStopStatus.mutate({ appointmentId: activeStop.appointmentId, status: 'arrived' })}
              >
                <Text style={styles.arriveBtnText}>Mark Arrived</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}

      <FlatList
        data={stops}
        keyExtractor={(s) => s.stopId}
        contentContainerStyle={{ padding: 14, paddingBottom: 100 }}
        refreshing={false}
        onRefresh={() => {
          void refetch();
        }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.stopCard} onPress={() => router.push(`/stop/${item.appointmentId}`)} activeOpacity={0.85}>
            <View style={styles.seqBadge}>
              <Text style={styles.seqText}>{item.stopOrder}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.stopHeader}>
                <Text style={styles.stopTime}>
                  {fmtTime(item.windowStart)} – {fmtTime(item.windowEnd)}
                </Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.stopName}>{item.company ?? item.customerName}</Text>
              <Text style={styles.stopAddr}>{item.addressLine1}, {item.city}</Text>
              <View style={styles.stopFooter}>
                <Text style={styles.stopSvc}>{item.services.map((s) => s.name).join(', ')}</Text>
                <Text style={styles.stopTotal}>{money(item.estimatedTotal)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, backgroundColor: '#0D0D0D' },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1D2A26', marginRight: 10 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  headerSub: { color: '#9CB3AD', marginTop: 2, fontSize: 12 },
  optBtn: { height: 30, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#2DC4A2', flexDirection: 'row', alignItems: 'center', gap: 6 },
  optText: { color: '#0D0D0D', fontWeight: '800', fontSize: 12 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  progressBg: { flex: 1, height: 8, borderRadius: 999, backgroundColor: '#E6EEEB', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2DC4A2' },
  progressPct: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  startBtn: { marginHorizontal: 14, marginTop: 6, marginBottom: 10, height: 40, borderRadius: 12, backgroundColor: '#2DC4A2', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  startBtnText: { color: '#0D0D0D', fontWeight: '900' },
  activeCard: { marginHorizontal: 14, marginTop: 6, marginBottom: 10, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, padding: 12 },
  activeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  activeName: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 4 },
  activeAddr: { color: colors.textMuted, marginTop: 2 },
  activeActions: { marginTop: 10, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  navBtn: { height: 34, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtnText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  openBtn: { height: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#0D0D0D', flexDirection: 'row', alignItems: 'center', gap: 6 },
  openBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  arriveBtn: { height: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#2DC4A2', alignItems: 'center', justifyContent: 'center' },
  arriveBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 12 },
  stopCard: { flexDirection: 'row', borderRadius: 14, padding: 12, marginBottom: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  seqBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8FBF6', marginRight: 10 },
  seqText: { color: colors.primaryDark, fontWeight: '800' },
  stopHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopTime: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  stopName: { color: colors.text, fontWeight: '800', marginTop: 4, fontSize: 15 },
  stopAddr: { color: colors.textMuted, marginTop: 2, fontSize: 13 },
  stopFooter: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  stopSvc: { color: colors.textMuted, flex: 1, marginRight: 8, fontSize: 12 },
  stopTotal: { color: colors.primaryDark, fontWeight: '900' },
});
