import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors } from '../../src/lib/theme';

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

  const techColorById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of technicians.data ?? []) map[t.employeeId] = t.color ?? colors.primary;
    return map;
  }, [technicians.data]);

  const onLongPress = async (coordinate: { latitude: number; longitude: number }) => {
    if (drawing && canManage) return;
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

  const onPressMap = (coordinate: { latitude: number; longitude: number }) => {
    if (!drawing || !canManage) return;
    setDraftPoints((prev) => [...prev, coordinate]);
  };

  const saveDraft = () => {
    if (!draftTechId) return Alert.alert('Select technician', 'Choose who owns this area.');
    if (!draftName.trim()) return Alert.alert('Area name required', 'Name this territory before saving.');
    if (draftPoints.length < 3) return Alert.alert('More points needed', 'Add at least 3 points to make an area.');
    createTerritory.mutate({ name: draftName.trim(), technicianId: draftTechId, points: draftPoints });
  };

  const pickTechnician = () => {
    const options = (technicians.data ?? []).slice(0, 6).map((t) => ({
      text: `${t.firstName} ${t.lastName}`,
      onPress: () => setDraftTechId(t.employeeId),
    }));
    Alert.alert('Select technician', 'Assign this area to a tech', [
      ...options,
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.screen}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={AUSTIN_REGION}
        onPress={(e) => onPressMap(e.nativeEvent.coordinate)}
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
        {draftPoints.map((p, idx) => (
          <Marker
            key={`draft-${idx}`}
            coordinate={p}
            pinColor={colors.primaryDark}
            title={`Point ${idx + 1}`}
          />
        ))}
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

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.toolbar}>
          {canManage && (
            <>
              <TouchableOpacity
                style={[styles.toolBtn, drawing && styles.toolBtnActive]}
                onPress={() => {
                  setDrawing((v) => !v);
                  setDraftPoints([]);
                }}
              >
                <Text style={[styles.toolBtnText, drawing && styles.toolBtnTextActive]}>
                  {drawing ? 'Stop' : 'Draw'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setDraftPoints([])}>
                <Text style={styles.toolBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.toolBtn}
                onPress={saveDraft}
                disabled={createTerritory.isPending}
              >
                <Text style={styles.toolBtnText}>{createTerritory.isPending ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </>
          )}
          <Text style={styles.helpText}>
            {drawing && canManage ? `${draftPoints.length} pts` : 'Long press to pin customer'}
          </Text>
        </View>

        {canManage && drawing && (
          <View style={styles.drawMeta}>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Area name"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TouchableOpacity style={styles.techPicker} onPress={pickTechnician}>
              <Text style={styles.techPickerText}>
                {draftTechId
                  ? `Tech: ${(technicians.data ?? []).find((t) => t.employeeId === draftTechId)?.firstName ?? 'Selected'}`
                  : 'Select Tech'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  overlay: { position: 'absolute', left: 10, right: 10, top: 10, gap: 8 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFFEE',
    borderRadius: 14,
    padding: 6,
    gap: 6,
  },
  toolBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnActive: {
    backgroundColor: '#E8FBF6',
    borderColor: colors.primary,
  },
  toolBtnText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  toolBtnTextActive: { color: colors.primaryDark },
  helpText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginLeft: 2 },
  drawMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFFEE',
    borderRadius: 14,
    padding: 8,
  },
  input: {
    height: 34,
    width: 140,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
  },
  techPicker: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  techPickerText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
});
