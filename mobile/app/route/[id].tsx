import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, fmtTime, money, statusColors } from '../../src/lib/theme';
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
  startLat: number | null;
  startLng: number | null;
  stops: Stop[];
  stopCount: number;
  completedCount: number;
}

export function openNavigation(lat: number, lng: number, label: string) {
  const encoded = encodeURIComponent(label);
  const url = Platform.select({
    ios: `maps://?daddr=${lat},${lng}&q=${encoded}`,
    default: `geo:${lat},${lng}?q=${lat},${lng}(${encoded})`,
  });
  Linking.openURL(url!).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
}

type ViewMode = 'list' | 'map';

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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

  const stops = data?.stops ?? [];
  const pendingStops = stops.filter((s) => !['completed', 'cancelled', 'no_access'].includes(s.status));
  const done = data?.completedCount ?? 0;
  const total = data?.stopCount ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const activeStop = routeStarted ? (pendingStops[activeStopIdx] ?? null) : null;

  const coords = useMemo(
    () =>
      stops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({ latitude: s.latitude!, longitude: s.longitude! })),
    [stops],
  );

  const region = coords.length
    ? {
        latitude: coords.reduce((a, c) => a + c.latitude, 0) / coords.length,
        longitude: coords.reduce((a, c) => a + c.longitude, 0) / coords.length,
        latitudeDelta: 0.14,
        longitudeDelta: 0.14,
      }
    : { latitude: 30.2672, longitude: -97.7431, latitudeDelta: 0.2, longitudeDelta: 0.2 };

  const startRoute = () => {
    if (pendingStops.length === 0) {
      Alert.alert('All done!', 'No pending stops on this route.');
      return;
    }
    setRouteStarted(true);
    setActiveStopIdx(0);
  };

  const goToStop = (stop: Stop) => {
    router.push(`/stop/${stop.appointmentId}`);
  };

  const nextStop = () => {
    void refetch();
    const next = activeStopIdx + 1;
    if (next >= pendingStops.length) {
      Alert.alert('Route Complete! 🎉', 'All stops have been visited.', [
        { text: 'Done', onPress: () => setRouteStarted(false) },
      ]);
    } else {
      setActiveStopIdx(next);
    }
  };

  if (isLoading || !data) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Dark header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#2DC4A2" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{data.technicianName}</Text>
          <Text style={styles.headerSub}>{total} stops · {done} done</Text>
        </View>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}
            onPress={() => setViewMode('list')}
          >
            <Ionicons name="list" size={16} color={viewMode === 'list' ? '#0D0D0D' : '#6B7C78'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'map' && styles.toggleBtnActive]}
            onPress={() => setViewMode('map')}
          >
            <Ionicons name="map" size={16} color={viewMode === 'map' ? '#0D0D0D' : '#6B7C78'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressPct}>{pct}%</Text>
      </View>

      <SyncBanner />

      {/* Map view */}
      {viewMode === 'map' && (
        <MapView style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={region} showsUserLocation>
          {stops.map(
            (s) =>
              s.latitude != null &&
              s.longitude != null && (
                <Marker
                  key={s.stopId}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  title={`${s.stopOrder}. ${s.company ?? s.customerName}`}
                  description={`${fmtTime(s.windowStart)}–${fmtTime(s.windowEnd)}`}
                  pinColor={s.status === 'completed' ? 'green' : activeStop?.stopId === s.stopId ? 'blue' : undefined}
                  onCalloutPress={() => goToStop(s)}
                />
              ),
          )}
          {coords.length > 1 && (
            <Polyline coordinates={coords} strokeColor="#2DC4A2" strokeWidth={3} />
          )}
        </MapView>
      )}

      {/* Active-stop navigation card (shows when route started) */}
      {routeStarted && activeStop && (
        <View style={styles.activeCard}>
          <View style={styles.activeCardTop}>
            <View style={styles.activeStopBadge}>
              <Text style={styles.activeStopNum}>{activeStop.stopOrder}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activeCardLabel}>NEXT STOP</Text>
              <Text style={styles.activeCardName}>{activeStop.company ?? activeStop.customerName}</Text>
              <Text style={styles.activeCardAddr}>{activeStop.addressLine1}, {activeStop.city}</Text>
            </View>
            <Text style={styles.activeCardTime}>{fmtTime(activeStop.windowStart)}</Text>
          </View>
          <View style={styles.activeCardActions}>
            {activeStop.latitude != null && activeStop.longitude != null && (
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() =>
                  openNavigation(activeStop.latitude!, activeStop.longitude!, activeStop.company ?? activeStop.customerName)
                }
                activeOpacity={0.8}
              >
                <Ionicons name="navigate" size={18} color="#0D0D0D" />
                <Text style={styles.navBtnText}>Navigate</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.startStopBtn}
              onPress={() => goToStop(activeStop)}
              activeOpacity={0.8}
            >
              <Ionicons name="play-circle" size={18} color="#fff" />
              <Text style={styles.startStopBtnText}>Start Service</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.activeProgress}>
            <Text style={styles.activeProgressText}>
              Stop {activeStopIdx + 1} of {pendingStops.length} remaining
            </Text>
            <TouchableOpacity onPress={nextStop}>
              <Text style={styles.skipText}>Skip →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Stop list */}
      <FlatList
        data={stops}
        keyExtractor={(s) => s.stopId}
        contentContainerStyle={{ padding: 14, paddingBottom: routeStarted ? 0 : 100 }}
        renderItem={({ item }) => {
          const isActive = routeStarted && activeStop?.stopId === item.stopId;
          const isDone = ['completed', 'cancelled', 'no_access'].includes(item.status);
          return (
            <TouchableOpacity
              style={[styles.stopCard, isActive && styles.stopCardActive, isDone && styles.stopCardDone]}
              onPress={() => goToStop(item)}
              activeOpacity={0.85}
            >
              <View style={[styles.seqBadge, isDone && styles.seqBadgeDone, isActive && styles.seqBadgeActive]}>
                {isDone ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <Text style={styles.seqText}>{item.stopOrder}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.stopHeader}>
                  <Text style={[styles.stopTime, isActive && { color: '#2DC4A2' }]}>
                    {fmtTime(item.windowStart)} – {fmtTime(item.windowEnd)}
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
                <Text style={[styles.stopName, isDone && styles.doneName]}>
                  {item.company ?? item.customerName}
                </Text>
                <Text style={styles.stopAddr}>{item.addressLine1}, {item.city}</Text>
                <View style={styles.stopFooter}>
                  <Text style={styles.stopSvc}>
                    {item.services.map((s) => s.name).join(', ')}
                  </Text>
                  <Text style={styles.stopTotal}>{money(item.estimatedTotal)}</Text>
                </View>
                {item.estimatedArrival ? (
                  <Text style={styles.eta}>ETA {fmtTime(item.estimatedArrival)}</Text>
                ) : null}
              </View>
              {item.latitude != null && item.longitude != null && !isDone && (
                <TouchableOpacity
                  onPress={() =>
                    openNavigation(item.latitude!, item.longitude!, item.company ?? item.customerName)
                  }
                  style={styles.miniNav}
                >
                  <Ionicons name="navigate-outline" size={20} color="#2DC4A2" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* Bottom action bar */}
      {!routeStarted ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          {hasPermission('routes:write') && (
            <TouchableOpacity
              style={styles.optimizeBtn}
              onPress={() => optimize.mutate()}
              disabled={optimize.isPending}
            >
              <Ionicons name="shuffle" size={18} color="#2DC4A2" />
              <Text style={styles.optimizeBtnText}>
                {optimize.isPending ? 'Optimizing…' : 'Optimize'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.startRouteBtn} onPress={startRoute} activeOpacity={0.85}>
            <Ionicons name="play" size={20} color="#0D0D0D" />
            <Text style={styles.startRouteBtnText}>Start Route</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.stopRouteBtn} onPress={() => setRouteStarted(false)}>
            <Ionicons name="stop-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.stopRouteBtnText}>End Route</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.nextBtn} onPress={nextStop}>
            <Text style={styles.nextBtnText}>Next Stop →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { marginRight: 10 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  headerSub: { color: '#6B7C78', fontSize: 12, marginTop: 1 },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 3,
  },
  toggleBtn: { padding: 6, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#2DC4A2' },
  progressWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 8,
  },
  progressBg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#2A2A2A' },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: '#2DC4A2' },
  progressPct: { color: '#2DC4A2', fontSize: 11, fontWeight: '800', marginLeft: 10 },
  map: { height: 220 },
  activeCard: {
    backgroundColor: '#0D0D0D',
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  activeCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  activeStopBadge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2DC4A2', alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  activeStopNum: { color: '#0D0D0D', fontWeight: '900', fontSize: 16 },
  activeCardLabel: { color: '#2DC4A2', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  activeCardName: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 2 },
  activeCardAddr: { color: '#8FA6A1', fontSize: 13, marginTop: 1 },
  activeCardTime: { color: '#2DC4A2', fontSize: 15, fontWeight: '800' },
  activeCardActions: { flexDirection: 'row', marginBottom: 10 },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2DC4A2', borderRadius: 12, paddingVertical: 11, marginRight: 8,
  },
  navBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 14, marginLeft: 6 },
  startStopBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1E8E5A', borderRadius: 12, paddingVertical: 11,
  },
  startStopBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, marginLeft: 6 },
  activeProgress: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeProgressText: { color: '#6B7C78', fontSize: 12 },
  skipText: { color: '#2DC4A2', fontSize: 13, fontWeight: '800' },
  stopCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 8,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  stopCardActive: { borderWidth: 2, borderColor: '#2DC4A2' },
  stopCardDone: { opacity: 0.55 },
  seqBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#2DC4A2', alignItems: 'center', justifyContent: 'center',
    marginRight: 10, marginTop: 2,
  },
  seqBadgeActive: { backgroundColor: '#0D0D0D' },
  seqBadgeDone: { backgroundColor: '#4A5A56' },
  seqText: { color: '#0D0D0D', fontWeight: '900', fontSize: 13 },
  stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stopTime: { fontSize: 13, fontWeight: '800', color: colors.text },
  stopName: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 2 },
  doneName: { textDecorationLine: 'line-through', color: colors.textMuted },
  stopAddr: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  stopFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  stopSvc: { fontSize: 12, color: colors.textMuted, flex: 1, marginRight: 6 },
  stopTotal: { fontSize: 13, fontWeight: '800', color: colors.text },
  eta: { fontSize: 11, color: colors.info, marginTop: 3, fontWeight: '700' },
  miniNav: { padding: 4, marginLeft: 4 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderTopWidth: 1, borderColor: colors.border,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  optimizeBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#2DC4A2',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10,
  },
  optimizeBtnText: { color: '#2DC4A2', fontWeight: '800', fontSize: 14, marginLeft: 6 },
  startRouteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2DC4A2', borderRadius: 14, paddingVertical: 14,
    shadowColor: '#2DC4A2', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  startRouteBtnText: { color: '#0D0D0D', fontWeight: '900', fontSize: 16, marginLeft: 8 },
  stopRouteBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10,
  },
  stopRouteBtnText: { color: colors.danger, fontWeight: '800', fontSize: 14, marginLeft: 6 },
  nextBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0D0D0D', borderRadius: 14, paddingVertical: 14,
  },
  nextBtnText: { color: '#2DC4A2', fontWeight: '900', fontSize: 16 },
});
