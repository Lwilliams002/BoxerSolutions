import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Callout, Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { CustomerStage, MapPin, STAGE_META, STAGE_ORDER, filterPins, pinColor, pinSubtitle, pinTitle } from '../../src/lib/mapPins';
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


// Fallback only — the map recenters on the device's location once permission
// is granted (applies to technicians and owners alike).
const FALLBACK_REGION = {
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
  const mapRef = useRef<MapView | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTechId, setDraftTechId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [locationGranted, setLocationGranted] = useState(false);
  const [stages, setStages] = useState<Set<CustomerStage>>(new Set(STAGE_ORDER));
  const [mapType, setMapType] = useState<'hybrid' | 'standard'>('hybrid');
  // Custom marker views need one tracked render on Android before we freeze them.
  const [trackMarkers, setTrackMarkers] = useState(true);

  // Center the map on the signed-in user's current location (tech or owner).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        setLocationGranted(true);
        const pos =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (cancelled || !pos) return;
        mapRef.current?.animateToRegion(
          {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.12,
            longitudeDelta: 0.12,
          },
          600,
        );
      } catch {
        // Keep the fallback region if location is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const territories = useQuery({
    queryKey: ['territories'],
    queryFn: () => api<Territory[]>('/territories/mine'),
  });
  const mapLocations = useQuery({
    queryKey: ['mapLocations'],
    queryFn: () => api<MapPin[]>('/locations/map'),
    refetchInterval: 60_000,
  });
  const visiblePins = useMemo(() => filterPins(mapLocations.data ?? [], stages), [mapLocations.data, stages]);
  useEffect(() => {
    setTrackMarkers(true);
    const t = setTimeout(() => setTrackMarkers(false), 1500);
    return () => clearTimeout(t);
  }, [mapLocations.data, mapType]);

  const goToMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Location off', 'Allow location access to jump to where you are.');
      setLocationGranted(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 500);
    } catch {
      Alert.alert('Location unavailable', 'Could not read your current position.');
    }
  };

  const toggleStage = (stage: CustomerStage) =>
    setStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
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
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        mapType={mapType}
        initialRegion={FALLBACK_REGION}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
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
        {visiblePins.map((c) => (
          <Marker
            key={c.id}
            coordinate={{ latitude: c.latitude, longitude: c.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            calloutAnchor={{ x: 0.5, y: 0.1 }}
            tracksViewChanges={trackMarkers}
            onCalloutPress={() => { if (c.canOpen) router.push(`/customer/${c.customerId}`); }}
          >
            <View style={styles.star}>
              <Ionicons name="star" size={30} color="#0D0D0D" style={styles.starShadow} />
              <Ionicons name="star" size={26} color={pinColor(c)} style={styles.starFill} />
            </View>
            <Callout tooltip={false}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{pinTitle(c)}</Text>
                <View style={styles.calloutStageRow}>
                  <View style={[styles.dot, { backgroundColor: pinColor(c) }]} />
                  <Text style={styles.calloutStage}>{pinSubtitle(c)}</Text>
                </View>
                <Text style={styles.calloutAddr}>{c.addressLine1}, {c.city}</Text>
                <Text style={styles.calloutHint}>{c.canOpen ? 'Tap to open customer' : 'View only'}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.overlay, styles.overlayPointerEvents]}>
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

        <View style={styles.legend}>
          {STAGE_ORDER.map((stage) => {
            const on = stages.has(stage);
            return (
              <TouchableOpacity key={stage} style={[styles.legendChip, !on && styles.legendChipOff]} onPress={() => toggleStage(stage)}>
                <View style={[styles.dot, { backgroundColor: STAGE_META[stage].color }]} />
                <Text style={[styles.legendText, !on && styles.legendTextOff]}>{STAGE_META[stage].label}</Text>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.legendCount}>{visiblePins.length} pins</Text>
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

      <View style={styles.fabs} pointerEvents="box-none">
        <TouchableOpacity style={styles.fab} onPress={() => setMapType((t) => (t === 'hybrid' ? 'standard' : 'hybrid'))} accessibilityLabel="Toggle map type">
          <Ionicons name={mapType === 'hybrid' ? 'map-outline' : 'earth-outline'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.fabPrimary]} onPress={() => void goToMyLocation()} accessibilityLabel="Go to my location">
          <Ionicons name="locate" size={22} color="#0D0D0D" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#FFFFFFEE', borderRadius: 14, padding: 6, gap: 6 },
  legendChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, height: 28, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  legendChipOff: { opacity: 0.45 },
  legendText: { fontSize: 12, fontWeight: '800', color: colors.text },
  legendTextOff: { textDecorationLine: 'line-through' },
  legendCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginLeft: 4 },
  callout: { minWidth: 200, maxWidth: 260, padding: 4 },
  calloutTitle: { fontWeight: '900', fontSize: 15, color: colors.text },
  calloutStageRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  calloutStage: { fontSize: 12, fontWeight: '700', color: colors.text, flex: 1 },
  calloutAddr: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  calloutHint: { fontSize: 11, color: colors.primaryDark, fontWeight: '800', marginTop: 6 },
  star: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  starShadow: { position: 'absolute', opacity: 0.55 },
  starFill: { position: 'absolute' },
  fabs: { position: 'absolute', right: 14, bottom: 24, gap: 10 },
  fab: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0D0D0D', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  fabPrimary: { backgroundColor: colors.primary },
  overlay: { position: 'absolute', left: 10, right: 10, top: 10, gap: 8 },
  overlayPointerEvents: { pointerEvents: 'box-none' },
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
