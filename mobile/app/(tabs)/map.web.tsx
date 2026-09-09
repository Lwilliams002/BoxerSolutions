import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors } from '../../src/lib/theme';
import { Loading } from '../../src/components/ui';
import { CustomerStage, MapPin, STAGE_META, STAGE_ORDER, filterPins, pinColor, pinSubtitle, pinTitle } from '../../src/lib/mapPins';

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
  const layersRef = useRef<{ pins: any; territories: any; imagery: any; labels: any; streets: any } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<Set<CustomerStage>>(new Set(STAGE_ORDER));
  const [hybrid, setHybrid] = useState(true);

  const territories = useQuery({ queryKey: ['territories'], queryFn: () => api<Territory[]>('/territories/mine') });
  const mapLocations = useQuery({ queryKey: ['mapLocations'], queryFn: () => api<MapPin[]>('/locations/map'), refetchInterval: 60_000 });
  const visiblePins = useMemo(() => filterPins(mapLocations.data ?? [], stages), [mapLocations.data, stages]);

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
        mapRef.current = map;
        layersRef.current = { pins, territories: terr, imagery, labels, streets };
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
      const marker = L.circleMarker([pin.latitude, pin.longitude], {
        radius: 9, color: '#FFFFFF', weight: 2, fillColor: pinColor(pin), fillOpacity: 0.95,
      });
      const popup = document.createElement('div');
      popup.style.minWidth = '200px';
      popup.innerHTML = `<div style="font:800 15px -apple-system,Helvetica,Arial,sans-serif;color:#0D0D0D">${escapeHtml(pinTitle(pin))}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font:700 12px Helvetica,Arial,sans-serif;color:#0D0D0D"><span style="width:10px;height:10px;border-radius:5px;background:${pinColor(pin)};display:inline-block"></span>${escapeHtml(pinSubtitle(pin))}</div>
        <div style="font:12px Helvetica,Arial,sans-serif;color:#607D78;margin-top:4px">${escapeHtml(`${pin.addressLine1}, ${pin.city}`)}</div>`;
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
          <Text style={styles.legendCount}>{visiblePins.length} pins{mapLocations.isLoading ? '…' : ''}</Text>
        </View>
        {canCreateCustomer ? (
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/customer/new')}>
            <Ionicons name="person-add-outline" size={16} color="#0D0D0D" />
            <Text style={styles.newBtnText}>New customer</Text>
          </TouchableOpacity>
        ) : null}
      </View>

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
});
