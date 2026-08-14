import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/authStore';
import { Button, Card, Row, SectionTitle } from '../src/components/ui';
import { colors } from '../src/lib/theme';

interface Tech {
  employeeId: string;
  firstName: string;
  lastName: string;
  color: string | null;
}

interface Territory {
  id: string;
  name: string;
  technicianId: string;
  polygon: { latitude: number; longitude: number }[];
  technicianFirstName: string;
  technicianLastName: string;
  technicianColor?: string | null;
}

interface MapLocation {
  id: string;
  customerId: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  firstName: string;
  lastName: string;
  company: string | null;
}

const AUSTIN_REGION = {
  latitude: 30.2672,
  longitude: -97.7431,
  latitudeDelta: 0.23,
  longitudeDelta: 0.23,
};

export default function TerritoryMapScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const canManage = hasPermission('users:write');
  const canCreateCustomer = hasPermission('customers:write');
  const [drawing, setDrawing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTechId, setDraftTechId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<{ latitude: number; longitude: number }[]>([]);

  const territories = useQuery({
    queryKey: ['territories'],
    queryFn: () => api<Territory[]>('/territories/mine'),
  });
  const mapLocations = useQuery({
    queryKey: ['mapLocations'],
    queryFn: () => api<MapLocation[]>('/locations/map'),
  });
  const technicians = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api<Tech[]>('/users/technicians'),
    enabled: canManage,
  });

  const createTerritory = useMutation({
    mutationFn: (body: { name: string; technicianId: string; points: { latitude: number; longitude: number }[] }) =>
      api('/territories', { method: 'POST', body }),
    onSuccess: async () => {
      setDraftPoints([]);
      setDraftName('');
      setDrawing(false);
      await qc.invalidateQueries({ queryKey: ['territories'] });
    },
    onError: (e) => Alert.alert('Unable to save area', (e as Error).message),
  });

  const deleteTerritory = useMutation({
    mutationFn: (id: string) => api(`/territories/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['territories'] });
    },
    onError: (e) => Alert.alert('Unable to delete area', (e as Error).message),
  });

  const techColorById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of technicians.data ?? []) map[t.employeeId] = t.color ?? colors.primary;
    return map;
  }, [technicians.data]);

  const onLongPress = async (coordinate: { latitude: number; longitude: number }) => {
    if (drawing && canManage) {
      setDraftPoints((prev) => [...prev, coordinate]);
      return;
    }
    if (!canCreateCustomer) return;
    let address = '';
    let city = '';
    let state = 'TX';
    let postal = '';
    try {
      const [geo] = await Location.reverseGeocodeAsync(coordinate);
      address = [geo?.streetNumber, geo?.street].filter(Boolean).join(' ');
      city = geo?.city ?? geo?.subregion ?? '';
      state = geo?.region ?? 'TX';
      postal = geo?.postalCode ?? '';
    } catch {
      // keep manual entry fallback
    }
    router.push({
      pathname: '/customer/new',
      params: {
        latitude: String(coordinate.latitude),
        longitude: String(coordinate.longitude),
        address1: address,
        city,
        state,
        postal,
      },
    });
  };

  const saveDraft = () => {
    if (!draftTechId) return Alert.alert('Select technician', 'Choose who owns this area.');
    if (!draftName.trim()) return Alert.alert('Area name required', 'Name this territory before saving.');
    if (draftPoints.length < 3) return Alert.alert('More points needed', 'Add at least 3 points to make an area.');
    createTerritory.mutate({ name: draftName.trim(), technicianId: draftTechId, points: draftPoints });
  };

  const removeArea = (id: string, name: string) => {
    Alert.alert('Delete area', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTerritory.mutate(id) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={AUSTIN_REGION}
        onLongPress={(e) => void onLongPress(e.nativeEvent.coordinate)}
      >
        {(territories.data ?? []).map((t) => (
          <Polygon
            key={t.id}
            coordinates={t.polygon ?? []}
            strokeWidth={2}
            strokeColor={techColorById[t.technicianId] ?? t.technicianColor ?? colors.primary}
            fillColor={(techColorById[t.technicianId] ?? t.technicianColor ?? colors.primary) + '26'}
          />
        ))}
        {draftPoints.length > 0 && (
          <Polygon coordinates={draftPoints} strokeWidth={2} strokeColor={colors.text} fillColor="#0D0D0D22" />
        )}
        {(mapLocations.data ?? []).map((c) => (
          <Marker
            key={c.id}
            coordinate={{ latitude: c.latitude, longitude: c.longitude }}
            title={c.company ?? `${c.firstName} ${c.lastName}`}
            description={`${c.addressLine1}, ${c.city}`}
            onCalloutPress={() => router.push(`/customer/${c.customerId}`)}
          />
        ))}
      </MapView>

      <View style={styles.overlay}>
        <Card>
          <SectionTitle>Territory Map</SectionTitle>
          <Text style={styles.helpText}>
            {drawing && canManage
              ? 'Tap points on the map to draw an area, then save it to a technician.'
              : 'Long press any house/location on the map to start creating a new customer there.'}
          </Text>
          {canManage && (
            <Row style={{ marginTop: 8 }}>
              <Button
                title={drawing ? 'Stop Drawing' : 'Draw Area'}
                variant={drawing ? 'secondary' : 'outline'}
                onPress={() => {
                  setDrawing((v) => !v);
                  setDraftPoints([]);
                }}
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button title="Clear" variant="outline" onPress={() => setDraftPoints([])} style={{ flex: 1, marginLeft: 6 }} />
            </Row>
          )}
        </Card>

        {canManage && drawing && (
          <Card>
            <Text style={styles.label}>Area Name</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="North Austin"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.label}>Technician</Text>
            <View style={styles.chipRow}>
              {(technicians.data ?? []).map((t) => (
                <TouchableOpacity
                  key={t.employeeId}
                  style={[styles.chip, draftTechId === t.employeeId && styles.chipActive]}
                  onPress={() => setDraftTechId(t.employeeId)}
                >
                  <View style={[styles.dot, { backgroundColor: t.color ?? colors.primary }]} />
                  <Text style={[styles.chipText, draftTechId === t.employeeId && styles.chipTextActive]}>
                    {t.firstName} {t.lastName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.pointsText}>{draftPoints.length} points added</Text>
            <Button title="Save Area" onPress={saveDraft} loading={createTerritory.isPending} />
          </Card>
        )}

        {canManage && (territories.data ?? []).length > 0 && (
          <Card>
            <SectionTitle>Assigned Areas</SectionTitle>
            {(territories.data ?? []).map((t) => (
              <Row key={t.id} style={styles.territoryRow}>
                <View style={[styles.dot, { backgroundColor: techColorById[t.technicianId] ?? t.technicianColor ?? colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.territoryName}>{t.name}</Text>
                  <Text style={styles.territoryMeta}>{t.technicianFirstName} {t.technicianLastName}</Text>
                </View>
                <TouchableOpacity onPress={() => removeArea(t.id, t.name)}>
                  <Text style={styles.delete}>Delete</Text>
                </TouchableOpacity>
              </Row>
            ))}
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  overlay: { position: 'absolute', left: 12, right: 12, top: 10, gap: 8 },
  helpText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 4, marginTop: 6 },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    color: colors.text,
    fontWeight: '700',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    height: 32,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: colors.primary, backgroundColor: '#E8FBF6' },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.text },
  chipTextActive: { color: colors.primaryDark, fontWeight: '900' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  pointsText: { color: colors.textMuted, marginBottom: 8, fontSize: 12, fontWeight: '700' },
  territoryRow: { minHeight: 40, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, marginTop: 8 },
  territoryName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  territoryMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  delete: { color: colors.danger, fontWeight: '800', fontSize: 13 },
});
