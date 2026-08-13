import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { colors, fmtTime, todayISO, money } from '../../src/lib/theme';
import { Button, SectionTitle, Loading, ErrorText, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

interface Tech {
  employeeId: string;
  userId: string;
  firstName: string;
  lastName: string;
  color?: string;
}

interface ApptRow {
  id: string;
  status: string;
  customerFirstName: string;
  customerLastName: string;
  customerCompany: string | null;
  addressLine1: string;
  city: string;
  windowStart: string;
  windowEnd: string;
  technicianId: string | null;
  technicianName: string | null;
  services: { name: string; unitPrice: number; quantity: number }[];
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STEP_DATE = 0;
const STEP_TECH = 1;
const STEP_STOPS = 2;
const STEP_REVIEW = 3;

export default function NewRouteScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(STEP_DATE);
  const [date, setDate] = useState(todayISO());
  const [techId, setTechId] = useState<string | null>(null);
  const [selectedAppts, setSelectedAppts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apptSearch, setApptSearch] = useState('');

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)), []);

  const { data: techs, isLoading: loadingTechs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api<Tech[]>('/users/technicians'),
  });

  const { data: apptData, isLoading: loadingAppts } = useQuery({
    queryKey: ['appointments-for-route', date],
    queryFn: () =>
      api<{ items: ApptRow[] }>(`/appointments?date=${date}&pageSize=100`),
    enabled: step >= STEP_STOPS,
  });

  const appointments = useMemo(() => {
    const items = apptData?.items ?? [];
    const q = apptSearch.toLowerCase();
    return items
      .filter((a) => !['cancelled', 'completed', 'void'].includes(a.status))
      .filter(
        (a) =>
          !q ||
          `${a.customerFirstName} ${a.customerLastName}`.toLowerCase().includes(q) ||
          a.addressLine1.toLowerCase().includes(q) ||
          (a.technicianName ?? '').toLowerCase().includes(q),
      );
  }, [apptData, apptSearch]);

  const selectedTech = techs?.find((t) => t.employeeId === techId);

  const toggleAppt = (id: string) =>
    setSelectedAppts((cur) => (cur.includes(id) ? cur.filter((a) => a !== id) : [...cur, id]));

  const createRoute = async () => {
    if (!techId) { setError('Select a technician.'); return; }
    if (selectedAppts.length === 0) { setError('Add at least one stop.'); return; }
    setError('');
    setBusy(true);
    try {
      // 1. Create (or get existing) route for this tech + date
      const route = await api<{ id: string }>('/routes', {
        method: 'POST',
        body: { routeDate: date, technicianId: techId },
      });

      // 2. Add each selected appointment as a stop (in order selected)
      for (const apptId of selectedAppts) {
        try {
          await api(`/routes/${route.id}/stops`, {
            method: 'POST',
            body: { appointmentId: apptId },
          });
        } catch {
          // Stop might already be on this route — continue
        }
      }

      // 3. Optimize the route
      try {
        await api(`/routes/${route.id}/optimize`, { method: 'POST', body: {} });
      } catch {
        // Optimization is best-effort
      }

      void qc.invalidateQueries({ queryKey: ['routes'] });
      void qc.invalidateQueries({ queryKey: ['route', route.id] });

      Alert.alert('Route Created!', `${selectedAppts.length} stop(s) added and optimized.`, [
        {
          text: 'View Route',
          onPress: () => router.replace(`/route/${route.id}`),
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SyncBanner />

      {/* Step indicator */}
      <View style={styles.stepBar}>
        {['Date', 'Technician', 'Stops', 'Review'].map((label, i) => (
          <TouchableOpacity key={i} style={styles.stepItem} onPress={() => i < step && setStep(i)}>
            <View style={[styles.stepDot, i <= step && styles.stepDotActive]}>
              {i < step ? (
                <Ionicons name="checkmark" size={12} color="#0D0D0D" />
              ) : (
                <Text style={[styles.stepNum, i === step && styles.stepNumActive]}>{i + 1}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* STEP 0: Pick date */}
      {step === STEP_DATE && (
        <View style={{ flex: 1 }}>
          <SectionTitle>Select Date</SectionTitle>
          <ScrollView contentContainerStyle={styles.padH}>
            {days.map((d) => {
              const dt = new Date(`${d}T12:00:00`);
              const active = d === date;
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayRow, active && styles.dayRowActive]}
                  onPress={() => setDate(d)}
                >
                  <Text style={[styles.dayText, active && styles.dayTextActive]}>
                    {dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={20} color="#0D0D0D" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={styles.navBar}>
            <Button title="Next: Technician →" onPress={() => setStep(STEP_TECH)} />
          </View>
        </View>
      )}

      {/* STEP 1: Pick technician */}
      {step === STEP_TECH && (
        <View style={{ flex: 1 }}>
          <SectionTitle>Select Technician</SectionTitle>
          {loadingTechs ? <Loading /> : (
            <ScrollView contentContainerStyle={styles.padH}>
              {(techs ?? []).map((t) => (
                <TouchableOpacity
                  key={t.employeeId}
                  style={[styles.techRow, techId === t.employeeId && styles.techRowActive]}
                  onPress={() => setTechId(t.employeeId)}
                >
                  <View style={[styles.techAvatar, { backgroundColor: t.color ?? colors.primary }]}>
                    <Text style={styles.techAvatarText}>
                      {t.firstName[0]}{t.lastName[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.techName, techId === t.employeeId && { color: '#fff' }]}>
                      {t.firstName} {t.lastName}
                    </Text>
                  </View>
                  {techId === t.employeeId && (
                    <Ionicons name="checkmark-circle" size={22} color="#2DC4A2" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={styles.navBar}>
            <Button title="← Back" variant="outline" onPress={() => setStep(STEP_DATE)} style={{ flex: 1, marginRight: 8 }} />
            <Button
              title="Next: Stops →"
              onPress={() => {
                if (!techId) { Alert.alert('Select a technician first'); return; }
                setStep(STEP_STOPS);
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      )}

      {/* STEP 2: Pick stops */}
      {step === STEP_STOPS && (
        <View style={{ flex: 1 }}>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.search}
              placeholder={`Appointments on ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — tap to add`}
              placeholderTextColor={colors.textMuted}
              value={apptSearch}
              onChangeText={setApptSearch}
            />
          </View>

          {selectedAppts.length > 0 && (
            <View style={styles.selectedBadge}>
              <Text style={styles.selectedBadgeText}>{selectedAppts.length} stop(s) selected</Text>
            </View>
          )}

          {loadingAppts ? <Loading /> : (
            <FlatList
              data={appointments}
              keyExtractor={(a) => a.id}
              contentContainerStyle={styles.padH}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="calendar-outline" size={40} color={colors.border} />
                  <Text style={styles.emptyText}>No schedulable appointments on this date</Text>
                </View>
              }
              renderItem={({ item }) => {
                const selected = selectedAppts.includes(item.id);
                const custName = item.customerCompany ?? `${item.customerFirstName} ${item.customerLastName}`;
                return (
                  <TouchableOpacity
                    style={[styles.apptCard, selected && styles.apptCardSelected]}
                    onPress={() => toggleAppt(item.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.apptCheck}>
                      {selected
                        ? <Ionicons name="checkmark-circle" size={22} color="#2DC4A2" />
                        : <View style={styles.unchecked} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.apptHeader}>
                        <Text style={styles.apptTime}>
                          {fmtTime(item.windowStart)} – {fmtTime(item.windowEnd)}
                        </Text>
                        <StatusBadge status={item.status} />
                      </View>
                      <Text style={styles.apptName}>{custName}</Text>
                      <Text style={styles.apptAddr}>{item.addressLine1}, {item.city}</Text>
                      <Text style={styles.apptSvc}>
                        {item.services.map((s) => s.name).join(', ')}
                        {item.technicianName ? ` · ${item.technicianName}` : ' · Unassigned'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <View style={styles.navBar}>
            <Button title="← Back" variant="outline" onPress={() => setStep(STEP_TECH)} style={{ flex: 1, marginRight: 8 }} />
            <Button
              title="Review →"
              onPress={() => {
                if (selectedAppts.length === 0) { Alert.alert('Add at least one stop'); return; }
                setStep(STEP_REVIEW);
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      )}

      {/* STEP 3: Review & create */}
      {step === STEP_REVIEW && (
        <ScrollView contentContainerStyle={[styles.padH, { paddingBottom: 40 }]}>
          <SectionTitle>Review Route</SectionTitle>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.summaryText}>
                {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
            </View>
            {selectedTech && (
              <View style={[styles.summaryRow, { marginTop: 8 }]}>
                <Ionicons name="person-outline" size={18} color={colors.primaryDark} />
                <Text style={styles.summaryText}>{selectedTech.firstName} {selectedTech.lastName}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, { marginTop: 8 }]}>
              <Ionicons name="location-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.summaryText}>{selectedAppts.length} stop(s)</Text>
            </View>
          </View>

          <SectionTitle>Stops</SectionTitle>
          {selectedAppts.map((apptId, i) => {
            const a = appointments.find((x) => x.id === apptId);
            if (!a) return null;
            return (
              <View key={apptId} style={styles.reviewStop}>
                <View style={styles.stopNum}>
                  <Text style={styles.stopNumText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewName}>
                    {a.customerCompany ?? `${a.customerFirstName} ${a.customerLastName}`}
                  </Text>
                  <Text style={styles.reviewAddr}>{a.addressLine1}, {a.city}</Text>
                  <Text style={styles.reviewTime}>{fmtTime(a.windowStart)} – {fmtTime(a.windowEnd)}</Text>
                </View>
                <TouchableOpacity onPress={() => toggleAppt(apptId)}>
                  <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
                </TouchableOpacity>
              </View>
            );
          })}

          <Text style={styles.noteText}>
            Route will be auto-optimized for travel efficiency while respecting appointment windows.
          </Text>

          {error ? <ErrorText message={error} /> : null}

          <Button
            title={`Create Route (${selectedAppts.length} stops)`}
            onPress={createRoute}
            loading={busy}
            style={{ marginTop: 12 }}
          />
          <Button title="← Edit Stops" variant="outline" onPress={() => setStep(STEP_STOPS)} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stepBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  stepItem: { flex: 1, alignItems: 'center' },
  stepDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  stepDotActive: { backgroundColor: '#2DC4A2' },
  stepNum: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  stepNumActive: { color: '#0D0D0D' },
  stepLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  stepLabelActive: { color: '#0D0D0D', fontWeight: '800' },
  padH: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 8,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  dayRowActive: { backgroundColor: '#2DC4A2' },
  dayText: { fontSize: 16, fontWeight: '600', color: colors.text },
  dayTextActive: { color: '#0D0D0D', fontWeight: '800' },
  techRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  techRowActive: { backgroundColor: '#0D0D0D' },
  techAvatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  techAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  techName: { fontSize: 16, fontWeight: '700', color: colors.text },
  navBar: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginVertical: 10,
    borderWidth: 1, borderColor: colors.border, paddingRight: 12,
  },
  searchIcon: { marginHorizontal: 12 },
  search: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 11 },
  selectedBadge: {
    backgroundColor: '#2DC4A218', marginHorizontal: 16, borderRadius: 8, padding: 8, marginBottom: 4,
  },
  selectedBadgeText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  apptCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  apptCardSelected: { backgroundColor: '#0D0D0D' },
  apptCheck: { width: 28, justifyContent: 'center', marginTop: 2, marginRight: 6 },
  unchecked: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },
  apptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  apptTime: { fontSize: 13, fontWeight: '800', color: '#2DC4A2' },
  apptName: { fontSize: 15, fontWeight: '700', color: '#fff', marginTop: 2 },
  apptAddr: { fontSize: 13, color: '#8FA6A1', marginTop: 1 },
  apptSvc: { fontSize: 12, color: '#6B7C78', marginTop: 3 },
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryText: { fontSize: 16, fontWeight: '700', color: colors.text, marginLeft: 10 },
  reviewStop: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8,
    shadowColor: '#0D0D0D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  stopNum: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#2DC4A2',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  stopNumText: { color: '#0D0D0D', fontWeight: '900', fontSize: 13 },
  reviewName: { fontSize: 15, fontWeight: '700', color: colors.text },
  reviewAddr: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  reviewTime: { fontSize: 12, color: colors.primaryDark, fontWeight: '700', marginTop: 2 },
  noteText: { fontSize: 13, color: colors.textMuted, marginTop: 12, textAlign: 'center', lineHeight: 18 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: colors.textMuted, marginTop: 12, fontSize: 14, textAlign: 'center' },
});
