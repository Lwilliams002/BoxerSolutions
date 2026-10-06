import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors } from '../../src/lib/theme';
import { Loading } from '../../src/components/ui';
import {
  CustomerStage, MapPin, STAGE_META, STAGE_ORDER, filterPins, pinColor, pinSubtitle, pinTitle,
  ProspectPin, ProspectStatus, PROSPECT_STATUS_META, PROSPECT_STATUS_ORDER, prospectTitle, prospectSubtitle, fmtPinDate, planLabel,
} from '../../src/lib/mapPins';
import { ProspectSheet, ProspectDraft } from '../../src/components/ProspectSheet';
import { confirmAction, notify } from '../../src/lib/confirm';

/**
 * Web territory map: Leaflet with Esri satellite imagery + place labels
 * (no API key), the same colored customer pins as the native map, territory
 * outlines, a stage filter and a "my location" button.
 */
interface Territory {
  id: string;
  name: string;
  technicianId: string;
  polygon: { latitude: number; longitude: number }[];
  technicianFirstName: string;
  technicianLastName: string;
  technicianColor?: string | null;
}

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const STREETS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const FALLBACK_CENTER: [number, number] = [25.94, -80.24];

type Leaflet = any;

let leafletPromise: Promise<Leaflet> | null = null;
function loadLeaflet(): Promise<Leaflet> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('customer-star-css')) {
      const style = document.createElement('style');
      style.id = 'customer-star-css';
      style.textContent = '.customer-star{background:transparent;border:0}';
      document.head.appendChild(style);
    }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => (w.L ? resolve(w.L) : reject(new Error('Leaflet did not load')));
    script.onerror = () => reject(new Error('Unable to load the map library'));
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function escapeHtml(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function TerritoryMapScreenWeb() {
  const router = useRouter();
  const hasPermission = useAuth((s) => s.hasPermission);
  const canCreateCustomer = hasPermission('customers:write');
  const hostRef = useRef<View | null>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<{ pins: any; territories: any; imagery: any; labels: any; streets: any; knocks: any } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<Set<CustomerStage>>(new Set(STAGE_ORDER));
  const [hybrid, setHybrid] = useState(true);
  const qc = useQueryClient();
  const [prospectFilter, setProspectFilter] = useState<Set<ProspectStatus>>(new Set(PROSPECT_STATUS_ORDER));
  const [sheet, setSheet] = useState<
    | { mode: 'new'; coordinate: { latitude: number; longitude: number }; address: { addressLine1: string; city: string; state: string; postalCode: string } | null }
    | { mode: 'edit'; pin: ProspectPin }
    | null
  >(null);
  const [savingPin, setSavingPin] = useState(false);
  const [callbacksOpen, setCallbacksOpen] = useState(false);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const territories = useQuery({ queryKey: ['territories'], queryFn: () => api<Territory[]>('/territories/mine') });
  const mapLocations = useQuery({ queryKey: ['mapLocations'], queryFn: () => api<MapPin[]>('/locations/map'), refetchInterval: 60_000 });
  const visiblePins = useMemo(() => filterPins(mapLocations.data ?? [], stages), [mapLocations.data, stages]);
  const prospects = useQuery({ queryKey: ['prospects'], queryFn: () => api<ProspectPin[]>('/prospects'), refetchInterval: 60_000 });
  const visibleProspects = useMemo(() => (prospects.data ?? []).filter((p) => prospectFilter.has(p.status)), [prospects.data, prospectFilter]);
  const callbacks = useQuery({ queryKey: ['prospectCallbacks'], queryFn: () => api<ProspectPin[]>('/prospects/callbacks?days=0'), refetchInterval: 120_000 });
  const refreshProspects = () => { void qc.invalidateQueries({ queryKey: ['prospects'] }); void qc.invalidateQueries({ queryKey: ['prospectCallbacks'] }); };

  /** Street address for a dropped pin (OpenStreetMap, no key needed). */
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      const a = j?.address ?? {};
      return {
        addressLine1: [a.house_number, a.road].filter(Boolean).join(' '),
        city: a.city ?? a.town ?? a.village ?? a.suburb ?? '',
        state: a.state === 'Florida' ? 'FL' : (a.state ?? 'FL'),
        postalCode: a.postcode ?? '',
      };
    } catch {
      return null;
    }
  };
  const openProspect = async (id: string) => {
    try { setSheet({ mode: 'edit', pin: await api<ProspectPin>(`/prospects/${id}`) }); } catch (e) { notify('Could not open pin', (e as Error).message); }
  };
  const saveProspect = async (draft: ProspectDraft) => {
    const current = sheetRef.current;
    if (!current) return;
    setSavingPin(true);
    try {
      const body = { status: draft.status, notes: draft.notes || null, contactName: draft.contactName || null, contactPhone: draft.contactPhone || null, callbackDate: draft.callbackDate, addressLine1: draft.addressLine1 || null };
      if (current.mode === 'new') {
        await api('/prospects', { method: 'POST', body: { ...body, latitude: current.coordinate.latitude, longitude: current.coordinate.longitude, city: current.address?.city || null, state: current.address?.state || null, postalCode: current.address?.postalCode || null } });
      } else {
        await api(`/prospects/${current.pin.id}`, { method: 'PATCH', body });
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
      title: 'Remove this pin?', message: 'The house and its knock history are removed from the map.', confirmText: 'Remove', destructive: true,
      onConfirm: async () => {
        try { await api(`/prospects/${pin.id}`, { method: 'DELETE' }); refreshProspects(); setSheet(null); } catch (e) { notify('Could not remove pin', (e as Error).message); }
      },
    });
  const convertProspect = (pin: ProspectPin) => {
    setSheet(null);
    const [first, ...rest] = (pin.contactName ?? '').trim().split(/\s+/);
    router.push({ pathname: '/customer/new', params: { latitude: String(pin.latitude), longitude: String(pin.longitude), address1: pin.addressLine1 ?? '', city: pin.city ?? '', state: pin.state ?? 'FL', postal: pin.postalCode ?? '', firstName: first ?? '', lastName: rest.join(' '), phone: pin.contactPhone ?? '' } });
  };
  const focusProspect = (pin: ProspectPin) => {
    setCallbacksOpen(false);
    mapRef.current?.setView([pin.latitude, pin.longitude], 17);
    void openProspect(pin.id);
  };

  // Create the map once the host <div> exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await loadLeaflet();
        const host = hostRef.current as unknown as HTMLElement | null;
        if (cancelled || !host || mapRef.current) return;
        const map = L.map(host, { center: FALLBACK_CENTER, zoom: 11, zoomControl: true });
        const imagery = L.tileLayer(IMAGERY, { maxZoom: 19, attribution: 'Imagery © Esri' });
        const labels = L.tileLayer(LABELS, { maxZoom: 19 });
        const streets = L.tileLayer(STREETS, { maxZoom: 19, attribution: '© OpenStreetMap' });
        imagery.addTo(map);
        labels.addTo(map);
        const pins = L.layerGroup().addTo(map);
        const terr = L.layerGroup().addTo(map);
        const knocks = L.layerGroup().addTo(map);
        mapRef.current = map;
        layersRef.current = { pins, territories: terr, imagery, labels, streets, knocks };
        // Right-click (or long press on touch) a house to drop a door-knock pin.
        if (canCreateCustomer) {
          map.on('contextmenu', async (e: any) => {
            const coordinate = { latitude: e.latlng.lat, longitude: e.latlng.lng };
            const address = await reverseGeocode(coordinate.latitude, coordinate.longitude);
            setSheet({ mode: 'new', coordinate, address });
          });
        }
        setReady(true);
        // Start on the user's location when the browser allows it.
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => { if (!cancelled) map.setView([pos.coords.latitude, pos.coords.longitude], 12); },
            () => undefined,
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
          );
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layersRef.current = null; }
    };
  }, []);

  // Base layer toggle.
  useEffect(() => {
    const map = mapRef.current; const layers = layersRef.current;
    if (!map || !layers) return;
    if (hybrid) { map.removeLayer(layers.streets); layers.imagery.addTo(map); layers.labels.addTo(map); }
    else { map.removeLayer(layers.imagery); map.removeLayer(layers.labels); layers.streets.addTo(map); }
  }, [hybrid, ready]);

  // Territory outlines.
  useEffect(() => {
    const L = (window as any).L; const layers = layersRef.current;
    if (!L || !layers) return;
    layers.territories.clearLayers();
    for (const t of territories.data ?? []) {
      const color = t.technicianColor ?? colors.primary;
      L.polygon((t.polygon ?? []).map((p) => [p.latitude, p.longitude]), { color, weight: 2, fillColor: color, fillOpacity: 0.15 })
        .bindTooltip(`${t.name} · ${t.technicianFirstName} ${t.technicianLastName}`)
        .addTo(layers.territories);
    }
  }, [territories.data, ready]);

  // Customer pins.
  useEffect(() => {
    const L = (window as any).L; const layers = layersRef.current;
    if (!L || !layers) return;
    layers.pins.clearLayers();
    for (const pin of visiblePins) {
      const icon = L.divIcon({
        className: 'customer-star',
        html: `<svg width="30" height="30" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="${pinColor(pin)}" stroke="#0D0D0D" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
        iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12],
      });
      const marker = L.marker([pin.latitude, pin.longitude], { icon, title: pinTitle(pin) });
      const popup = document.createElement('div');
      popup.style.minWidth = '200px';
      popup.innerHTML = `<div style="font:800 15px -apple-system,Helvetica,Arial,sans-serif;color:#0D0D0D">${escapeHtml(pinTitle(pin))}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font:700 12px Helvetica,Arial,sans-serif;color:#0D0D0D"><span style="width:10px;height:10px;border-radius:5px;background:${pinColor(pin)};display:inline-block"></span>${escapeHtml(pinSubtitle(pin))}</div>
        <div style="font:12px Helvetica,Arial,sans-serif;color:#607D78;margin-top:4px">${escapeHtml(`${pin.addressLine1}, ${pin.city}`)}</div>
        ${pin.createdAt ? `<div style="font:11px Helvetica,Arial,sans-serif;color:#607D78;margin-top:3px">Since ${escapeHtml(fmtPinDate(pin.createdAt) ?? '')}${pin.dealOwnerName ? ` · signed by ${escapeHtml(pin.dealOwnerName)}` : ''}</div>` : ''}
        ${pin.lastServiceDate ? `<div style="font:11px Helvetica,Arial,sans-serif;color:#607D78">Last serviced ${escapeHtml(fmtPinDate(pin.lastServiceDate) ?? '')}</div>` : ''}
        ${pin.nextServiceDate ? `<div style="font:11px Helvetica,Arial,sans-serif;color:#607D78">Next visit ${escapeHtml(fmtPinDate(pin.nextServiceDate) ?? '')}</div>` : ''}
        ${planLabel(pin) ? `<div style="font:800 12px Helvetica,Arial,sans-serif;color:#0D0D0D;margin-top:3px">${escapeHtml(planLabel(pin) ?? '')}</div>` : ''}`;
      if (pin.canOpen) {
        const btn = document.createElement('button');
        btn.textContent = 'Open customer';
        btn.setAttribute('style', 'margin-top:8px;background:#2DC4A2;color:#0D0D0D;border:0;border-radius:8px;padding:7px 10px;font:800 12px Helvetica,Arial,sans-serif;cursor:pointer');
        btn.onclick = () => router.push(`/customer/${pin.customerId}`);
        popup.appendChild(btn);
      } else {
        const note = document.createElement('div');
        note.textContent = 'View only';
        note.setAttribute('style', 'margin-top:8px;font:800 11px Helvetica,Arial,sans-serif;color:#607D78');
        popup.appendChild(note);
      }
      marker.bindPopup(popup);
      marker.addTo(layers.pins);
    }
  }, [visiblePins, ready]);

  // Door-knock pins.
  useEffect(() => {
    const L = (window as any).L; const layers = layersRef.current;
    if (!L || !layers) return;
    layers.knocks.clearLayers();
    for (const p of visibleProspects) {
      const color = PROSPECT_STATUS_META[p.status].color;
      const icon = L.divIcon({
        className: 'knock-pin',
        html: `<svg width="30" height="34" viewBox="0 0 24 28" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M12 1C6.5 1 2.5 5.2 2.5 10.4c0 6.6 9.5 16.1 9.5 16.1s9.5-9.5 9.5-16.1C21.5 5.2 17.5 1 12 1z" fill="${color}" stroke="#0D0D0D" stroke-width="1.2"/><circle cx="12" cy="10.4" r="3.6" fill="#fff"/></svg>`,
        iconSize: [30, 34], iconAnchor: [15, 33],
      });
      const marker = L.marker([p.latitude, p.longitude], { icon, title: prospectTitle(p) });
      marker.bindTooltip(`${prospectTitle(p)} · ${prospectSubtitle(p)}`);
      marker.on('click', () => void openProspect(p.id));
      marker.addTo(layers.knocks);
    }
  }, [visibleProspects, ready]);

  const goToMyLocation = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => setError('Location access was denied by the browser.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const toggleStage = (stage: CustomerStage) =>
    setStages((prev) => { const next = new Set(prev); if (next.has(stage)) next.delete(stage); else next.add(stage); return next; });

  return (
    <View style={styles.screen}>
      {/* Leaflet mounts into this View's DOM node. */}
      <View ref={hostRef} style={styles.map} />
      {!ready && !error ? <View style={styles.center} pointerEvents="none"><Loading /></View> : null}
      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

      <View style={styles.overlay} pointerEvents="box-none">
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
          <Text style={styles.legendCount}>{visiblePins.length} customers{mapLocations.isLoading ? '…' : ''}</Text>
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
          <TouchableOpacity style={[styles.legendChip, { borderColor: '#F2994A' }]} onPress={() => setCallbacksOpen(true)}>
            <Ionicons name="call-outline" size={14} color="#F2994A" />
            <Text style={[styles.legendText, { marginLeft: 4 }]}>Call backs due{(callbacks.data?.length ?? 0) ? ` ${callbacks.data!.length}` : ''}</Text>
          </TouchableOpacity>
          {canCreateCustomer ? <Text style={styles.legendCount}>Right-click a house to drop a pin</Text> : null}
        </View>
        {canCreateCustomer ? (
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/customer/new')}>
            <Ionicons name="person-add-outline" size={16} color="#0D0D0D" />
            <Text style={styles.newBtnText}>New customer</Text>
          </TouchableOpacity>
        ) : null}
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
        <Modal transparent animationType="fade" visible onRequestClose={() => setCallbacksOpen(false)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setCallbacksOpen(false)}>
            <Pressable style={styles.sheetCard} onPress={() => undefined}>
              <Text style={styles.sheetTitle}>Call backs due</Text>
              <Text style={styles.sheetSub}>Houses that asked you to come back today or earlier. Click one to jump to it.</Text>
              <ScrollView style={{ maxHeight: 380 }}>
                {(callbacks.data ?? []).length === 0 ? <Text style={styles.sheetSub}>Nothing due.</Text> : null}
                {(callbacks.data ?? []).map((p) => (
                  <TouchableOpacity key={p.id} style={styles.cbRow} onPress={() => focusProspect(p)}>
                    <View style={[styles.dot, { backgroundColor: PROSPECT_STATUS_META[p.status].color, marginTop: 5 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cbTitle}>{prospectTitle(p)}{p.contactName ? ` · ${p.contactName}` : ''}</Text>
                      <Text style={styles.cbMeta}>{prospectSubtitle(p)}</Text>
                      {p.notes ? <Text style={styles.cbMeta} numberOfLines={2}>{p.notes}</Text> : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      <View style={styles.fabs} pointerEvents="box-none">
        <TouchableOpacity style={styles.fab} onPress={() => setHybrid((v) => !v)} accessibilityLabel="Toggle map type">
          <Ionicons name={hybrid ? 'map-outline' : 'earth-outline'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.fabPrimary]} onPress={goToMyLocation} accessibilityLabel="Go to my location">
          <Ionicons name="locate" size={22} color="#0D0D0D" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1, minHeight: 400 },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  errorBox: { position: 'absolute', left: 14, right: 14, top: 14, backgroundColor: '#FDECEC', borderRadius: 10, padding: 10 },
  errorText: { color: '#8A1C1C', fontWeight: '700' },
  overlay: { position: 'absolute', left: 10, right: 10, top: 10, gap: 8, alignItems: 'flex-start', zIndex: 1000 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', backgroundColor: '#FFFFFFEE', borderRadius: 14, padding: 6, gap: 6 },
  legendChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, height: 28, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  legendChipOff: { opacity: 0.45 },
  legendText: { fontSize: 12, fontWeight: '800', color: colors.text },
  legendTextOff: { textDecorationLine: 'line-through' },
  legendCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginLeft: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 12, height: 34 },
  newBtnText: { fontWeight: '800', color: '#0D0D0D', fontSize: 13 },
  fabs: { position: 'absolute', right: 14, bottom: 24, gap: 10, zIndex: 1000 },
  fab: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(13,13,13,0.25)' } as any,
  fabPrimary: { backgroundColor: colors.primary },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheetCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%', maxWidth: 520 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  cbRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cbTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  cbMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
