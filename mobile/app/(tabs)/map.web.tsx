import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors } from '../../src/lib/theme';
import { Card, Loading } from '../../src/components/ui';

interface Territory {
  id: string;
  name: string;
  technicianId: string;
  polygon: { latitude: number; longitude: number }[];
  technicianFirstName: string;
  technicianLastName: string;
}
interface MapLocation {
  id: string;
  customerId: string;
  addressLine1: string;
  city: string;
  latitude: number;
  longitude: number;
  firstName: string;
  lastName: string;
  company: string | null;
}

function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function TerritoryMapScreenWeb() {
  const router = useRouter();
  const hasPermission = useAuth((s) => s.hasPermission);
  const canCreateCustomer = hasPermission('customers:write');
  const [myLocation, setMyLocation] = useState<{ lat: number; lon: number } | null>(null);

  // Use the browser's location (tech or owner) to sort customers by proximity.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  const territories = useQuery({
    queryKey: ['territories'],
    queryFn: () => api<Territory[]>('/territories/mine'),
  });
  const mapLocations = useQuery({
    queryKey: ['mapLocations'],
    queryFn: () => api<MapLocation[]>('/locations/map'),
  });

  const sortedLocations = useMemo(() => {
    const items = (mapLocations.data ?? []).map((c) => ({
      ...c,
      distance: myLocation ? distanceMiles(myLocation, { lat: c.latitude, lon: c.longitude }) : null,
    }));
    if (myLocation) items.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return items;
  }, [mapLocations.data, myLocation]);

  if (territories.isLoading || mapLocations.isLoading) return <Loading />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Territory map on web</Text>
        <Text style={styles.body}>
          Interactive map drawing is available in the mobile apps. Web shows customer pins and territory coverage details.
        </Text>
      </Card>

      <Card>
        <Text style={styles.section}>Editing territories</Text>
        <Text style={styles.body}>
          Territory drawing is only available in the mobile map right now. Use mobile to create or edit polygon boundaries.
        </Text>
      </Card>

      <Card>
        <Text style={styles.section}>Territories</Text>
        {(territories.data ?? []).map((t) => (
          <View key={t.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t.name}</Text>
              <Text style={styles.rowSub}>{t.technicianFirstName} {t.technicianLastName} · {t.polygon?.length ?? 0} points</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.section}>Customer locations</Text>
        {myLocation ? <Text style={styles.note}>Sorted by distance from your current location.</Text> : null}
        {sortedLocations.map((c) => (
          <TouchableOpacity key={c.id} style={styles.row} onPress={() => router.push(`/customer/${c.customerId}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{c.company ?? `${c.firstName} ${c.lastName}`}</Text>
              <Text style={styles.rowSub}>
                {c.addressLine1}, {c.city}
                {c.distance != null ? ` · ${c.distance.toFixed(1)} mi away` : ''}
              </Text>
            </View>
            <Text style={styles.open}>Open</Text>
          </TouchableOpacity>
        ))}
        {!canCreateCustomer ? (
          <Text style={styles.note}>You do not have permission to create customers from the map.</Text>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, gap: 10, paddingBottom: 24 },
  title: { color: colors.text, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  section: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  body: { color: colors.textMuted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 10 },
  rowTitle: { color: colors.text, fontWeight: '700' },
  rowSub: { color: colors.textMuted, marginTop: 2, fontSize: 12 },
  open: { color: colors.primaryDark, fontWeight: '800' },
  note: { color: colors.textMuted, marginTop: 10, fontSize: 12 },
});
