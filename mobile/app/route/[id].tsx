import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, fmtTime, money, statusColors } from '../../src/lib/theme';
import { Loading, StatusBadge, Button } from '../../src/components/ui';
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
}

export function openNavigation(lat: number, lng: number, label: string) {
  const encoded = encodeURIComponent(label);
  const url = Platform.select({
    ios: `maps://?daddr=${lat},${lng}&q=${encoded}`,
    default: `geo:${lat},${lng}?q=${lat},${lng}(${encoded})`,
  });
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
}

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [showMap, setShowMap] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['route', id],
    queryFn: () => api<RouteDetail>(`/routes/${id}`),
  });

  const optimize = useMutation({
    mutationFn: () => api(`/routes/${id}/optimize`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route', id] }),
  });

  const coords = useMemo(
    () =>
      (data?.stops ?? [])
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({ latitude: s.latitude!, longitude: s.longitude! })),
    [data],
  );

  if (isLoading || !data) return <Loading />;

  const region = coords.length
    ? {
        latitude: coords.reduce((a, c) => a + c.latitude, 0) / coords.length,
        longitude: coords.reduce((a, c) => a + c.longitude, 0) / coords.length,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      }
    : { latitude: 30.2672, longitude: -97.7431, latitudeDelta: 0.2, longitudeDelta: 0.2 };

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      {showMap ? (
        <MapView style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={region} showsUserLocation>
          {data.stops.map(
            (s) =>
              s.latitude != null &&
              s.longitude != null && (
                <Marker
                  key={s.stopId}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  title={`${s.stopOrder}. ${s.customerName}`}
                  description={`${fmtTime(s.windowStart)}–${fmtTime(s.windowEnd)}`}
                  pinColor={s.status === 'completed' ? 'green' : statusColors[s.status] ? undefined : undefined}
                  onCalloutPress={() => router.push(`/stop/${s.appointmentId}`)}
                />
              ),
          )}
          {coords.length > 1 && <Polyline coordinates={coords} strokeColor={colors.primary} strokeWidth={3} />}
        </MapView>
      ) : null}

      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => setShowMap((v) => !v)}>
          <Text style={styles.toolbarBtn}>{showMap ? 'Hide Map' : 'Show Map'}</Text>
        </TouchableOpacity>
        {hasPermission('routes:write') && (
          <TouchableOpacity onPress={() => optimize.mutate()} disabled={optimize.isPending}>
            <Text style={styles.toolbarBtn}>{optimize.isPending ? 'Optimizing…' : 'Optimize Route'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={data.stops}
        keyExtractor={(s) => s.stopId}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.stopCard} onPress={() => router.push(`/stop/${item.appointmentId}`)}>
            <View style={styles.seqBadge}>
              <Text style={styles.seqText}>{item.stopOrder}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.stopHeader}>
                <Text style={styles.time}>
                  {fmtTime(item.windowStart)} – {fmtTime(item.windowEnd)}
                </Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.name}>{item.company ?? item.customerName}</Text>
              <Text style={styles.addr}>
                {item.addressLine1}, {item.city}
              </Text>
              <Text style={styles.svc}>
                {item.services.map((s) => s.name).join(', ')} · {money(item.estimatedTotal)}
              </Text>
              {item.estimatedArrival ? (
                <Text style={styles.eta}>ETA {fmtTime(item.estimatedArrival)}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toolbarBtn: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  stopCard: {
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
  seqBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  seqText: { color: '#0D0D0D', fontWeight: '900', fontSize: 13 },
  stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontSize: 13, fontWeight: '700', color: colors.text },
  name: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },
  addr: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  svc: { fontSize: 13, color: colors.text, marginTop: 4 },
  eta: { fontSize: 12, color: colors.info, marginTop: 3, fontWeight: '600' },
});
