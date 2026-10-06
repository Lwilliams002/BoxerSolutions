import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Callout, Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import {
  CustomerStage, MapPin, STAGE_META, STAGE_ORDER, filterPins, pinColor, pinSubtitle, pinTitle,
  ProspectPin, ProspectStatus, PROSPECT_STATUS_META, PROSPECT_STATUS_ORDER, prospectTitle, prospectSubtitle, fmtPinDate, planLabel,
} from '../../src/lib/mapPins';
import { ProspectSheet, ProspectDraft } from '../../src/components/ProspectSheet';
import { confirmAction, notify } from '../../src/lib/confirm';
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
  // South Florida service area (Miami-Dade / Broward), matching the web map.
  latitude: 25.94,
  longitude: -80.24,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
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
  // Door-knocking pins: which statuses show, the open sheet, and the call-back list.
  const [prospectFilter, setProspectFilter] = useState<Set<ProspectStatus>>(new Set(PROSPECT_STATUS_ORDER));
  const [sheet, setSheet] = useState<
    | { mode: 'new'; coordinate: { latitude: number; longitude: number }; address: { addressLine1: string; city: string; state: string; postalCode: string } | null }
    | { mode: 'edit'; pin: ProspectPin }
    | null
  >(null);
  const [savingPin, setSavingPin] = useState(false);
  const [callbacksOpen, setCallbacksOpen] = useState(false);
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
  const prospects = useQuery({
    queryKey: ['prospects'],
    queryFn: () => api<ProspectPin[]>('/prospects'),
    refetchInterval: 60_000,
  });
  const visibleProspects = useMemo(() => (prospects.data ?? []).filter((p) => prospectFilter.has(p.status)), [prospects.data, prospectFilter]);
  const callbacks = useQuery({
    queryKey: ['prospectCallbacks'],
    queryFn: () => api<ProspectPin[]>('/prospects/callbacks?days=0'),
    refetchInterval: 120_000,
  });
  const refreshProspects = () => {
    void qc.invalidateQueries({ queryKey: ['prospects'] });
    void qc.invalidateQueries({ queryKey: ['prospectCallbacks'] });
  };
  const reverseGeocode = async (coordinate: { latitude: number; longitude: number }) => {
    try {
      const [geo] = await Location.reverseGeocodeAsync(coordinate);
      return {
        addressLine1: [geo?.streetNumber, geo?.street].filter(Boolean).join(' '),
        city: geo?.city ?? geo?.subregion ?? '',
        state: geo?.region ?? 'FL',
        postalCode: geo?.postalCode ?? '',
      };
    } catch {
      return null;
    }
  };
  const openProspect = async (id: string) => {
    try {
      const pin = await api<ProspectPin>(`/prospects/${id}`);
      setSheet({ mode: 'edit', pin });
    } catch (e) {
      notify('Could not open pin', (e as Error).message);
    }
  };
  const saveProspect = async (draft: ProspectDraft) => {
    if (!sheet) return;
    setSavingPin(true);
    try {
      const body = {
        status: draft.status,
        notes: draft.notes || null,
        contactName: draft.contactName || null,
        contactPhone: draft.contactPhone || null,
        callbackDate: draft.callbackDate,
        addressLine1: draft.addressLine1 || null,
      };
      if (sheet.mode === 'new') {
        await api('/prospects', { method: 'POST', body: { ...body, latitude: sheet.coordinate.latitude, longitude: sheet.coordinate.longitude, city: sheet.address?.city || null, state: sheet.address?.state || null, postalCode: sheet.address?.postalCode || null } });
      } else {
        await api(`/prospects/${sheet.pin.id}`, { method: 'PATCH', body });
      }
      refreshProspects();
      setSheet(null);
    } catch (e) {
      notify('Could not save pin', (e as Error).message);
    } finally {
      setSavingPin(false);
    }
  };
  const deleteProspect = (pin: ProspectPin) =>
    confirmAction({
      title: 'Remove this pin?',
      message: 'The house and its knock history are removed from the map.',
      confirmText: 'Remove',
      destructive: true,
      onConfirm: async () => {
        try {
          await api(`/prospects/${pin.id}`, { method: 'DELETE' });
          refreshProspects();
          setSheet(null);
        } catch (e) {
          notify('Could not remove pin', (e as Error).message);
        }
      },
    });
  /** Start the new-customer form at this house; the pin turns green once the customer is created here. */
  const convertProspect = (pin: ProspectPin) => {
    setSheet(null);
    const [first, ...rest] = (pin.contactName ?? '').trim().split(/\s+/);
    router.push({
      pathname: '/customer/new',
      params: {
        latitude: String(pin.latitude), longitude: String(pin.longitude),
        address1: pin.addressLine1 ?? '', city: pin.city ?? '', state: pin.state ?? 'FL', postal: pin.postalCode ?? '',
        firstName: first ?? '', lastName: rest.join(' '), phone: pin.contactPhone ?? '',
      },
    });
  };
  const focusProspect = (pin: ProspectPin) => {
    setCallbacksOpen(false);
    mapRef.current?.animateToRegion({ latitude: pin.latitude, longitude: pin.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
    void openProspect(pin.id);
  };
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

  /** Long press on a house: drop a door-knock pin, or start a customer there. */
  const onLongPress = async (coordinate: { latitude: number; longitude: number }) => {
    if (drawing && canManage) return;
    if (!canCreateCustomer) return;
    const address = await reverseGeocode(coordinate);
    const label = address?.addressLine1 ? address.addressLine1 : 'this spot';
    Alert.alert(label, 'What do you want to do here?', [
      { text: 'Drop pin (door knock)', onPress: () => setSheet({ mode: 'new', coordinate, address }) },
      {
        text: 'New customer',
        onPress: () => router.push({
          pathname: '/customer/new',
          params: { latitude: String(coordinate.latitude), longitude: String(coordinate.longitude), address1: address?.addressLine1 ?? '', city: address?.city ?? '', state: address?.state ?? 'FL', postal: address?.postalCode ?? '' },
        }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
                {c.createdAt ? <Text style={styles.calloutMeta}>Since {fmtPinDate(c.createdAt)}{c.dealOwnerName ? ` · signed by ${c.dealOwnerName}` : ''}</Text> : null}
                {c.lastServiceDate ? <Text style={styles.calloutMeta}>Last serviced {fmtPinDate(c.lastServiceDate)}</Text> : null}
                {c.nextServiceDate ? <Text style={styles.calloutMeta}>Next visit {fmtPinDate(c.nextServiceDate)}</Text> : null}
                {planLabel(c) ? <Text style={styles.calloutPlan}>{planLabel(c)}</Text> : null}
                <Text style={styles.calloutHint}>{c.canOpen ? 'Tap to open customer' : 'View only'}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
        {visibleProspects.map((p) => (
          <Marker
            key={`prospect-${p.id}`}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={trackMarkers}
            onPress={() => void openProspect(p.id)}
          >
            <View style={styles.prospectPin}>
              <Ionicons name="location" size={34} color="#0D0D0D" style={styles.starShadow} />
              <Ionicons name="location" size={30} color={PROSPECT_STATUS_META[p.status].color} style={styles.starFill} />
              <Ionicons name={PROSPECT_STATUS_META[p.status].icon as any} size={11} color="#fff" style={styles.prospectGlyph} />
            </View>
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
            {drawing && canManage ? `${draftPoints.length} pts` : 'Long press a house to drop a pin'}
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
          <Text style={styles.legendCount}>{visiblePins.length} customers</Text>
        </View>
        <View style={styles.legend}>
          {PROSPECT_STATUS_ORDER.map((s) => {
            const on = prospectFilter.has(s);
            const n = (prospects.data ?? []).filter((p) => p.status === s).length;
            return (
              <TouchableOpacity key={s} style={[styles.legendChip, !on && styles.legendChipOff]} onPress={() => setProspectFilter((prev) => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; })}>
                <View style={[styles.dot, { backgroundColor: PROSPECT_STATUS_META[s].color }]} />
                <Text style={[styles.legendText, !on && styles.legendTextOff]}>{PROSPECT_STATUS_META[s].label}{n ? ` ${n}` : ''}</Text>
              </TouchableOpacity>
            );
          })}
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
        <TouchableOpacity style={styles.fab} onPress={() => setCallbacksOpen(true)} accessibilityLabel="Call backs due">
          <Ionicons name="call-outline" size={22} color={colors.text} />
          {(callbacks.data?.length ?? 0) > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{callbacks.data!.length}</Text></View> : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={() => setMapType((t) => (t === 'hybrid' ? 'standard' : 'hybrid'))} accessibilityLabel="Toggle map type">
          <Ionicons name={mapType === 'hybrid' ? 'map-outline' : 'earth-outline'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.fabPrimary]} onPress={() => void goToMyLocation()} accessibilityLabel="Go to my location">
          <Ionicons name="locate" size={22} color="#0D0D0D" />
        </TouchableOpacity>
      </View>

      {sheet ? (
        <ProspectSheet
          pin={sheet.mode === 'edit' ? sheet.pin : null}
          address={sheet.mode === 'new' ? sheet.address : null}
          saving={savingPin}
          onSave={(d) => void saveProspect(d)}
          onConvert={sheet.mode === 'edit' && canCreateCustomer ? () => convertProspect(sheet.pin) : undefined}
          onDelete={sheet.mode === 'edit' && canCreateCustomer ? () => deleteProspect(sheet.pin) : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {callbacksOpen ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setCallbacksOpen(false)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setCallbacksOpen(false)}>
            <Pressable style={styles.sheetCard} onPress={() => undefined}>
              <Text style={styles.sheetTitle}>Call backs due</Text>
              <Text style={styles.sheetSub}>Houses that asked you to come back today or earlier. Tap one to jump to it.</Text>
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {(callbacks.data ?? []).length === 0 ? <Text style={styles.sheetSub}>Nothing due. Nice.</Text> : null}
                {(callbacks.data ?? []).map((p) => (
                  <TouchableOpacity key={p.id} style={styles.cbRow} onPress={() => focusProspect(p)}>
                    <View style={[styles.dot, { backgroundColor: PROSPECT_STATUS_META[p.status].color, marginTop: 5 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cbTitle}>{prospectTitle(p)}{p.contactName ? ` · ${p.contactName}` : ''}</Text>
                      <Text style={styles.cbMeta}>{prospectSubtitle(p)}</Text>
                      {p.notes ? <Text style={styles.cbMeta} numberOfLines={2}>{p.notes}</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  prospectPin: { width: 36, height: 38, alignItems: 'center', justifyContent: 'flex-start' },
  prospectGlyph: { position: 'absolute', top: 7 },
  calloutMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  calloutPlan: { fontSize: 12, fontWeight: '800', color: colors.text, marginTop: 4 },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#F2994A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheetCard: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  cbRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cbTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  cbMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
