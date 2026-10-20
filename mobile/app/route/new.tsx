import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, FlatList, StyleSheet, TouchableOpacity, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { notify } from '../../src/lib/confirm';
import { useAuth } from '../../src/lib/authStore';
import { colors, fmtTime, todayISO, money, fmtDate } from '../../src/lib/theme';
import { Button, SectionTitle, Loading, ErrorText, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

interface Tech {
  employeeId: string;
  userId: string;
  firstName: string;
  lastName: string;
  color?: string;
  isOwner?: boolean;
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
  services: { name: string; unitPrice: number; quantity: number }[] | null;
}

/** A customer as the route builder sees them: their visit on the route day, or their next visit elsewhere. */
interface Candidate {
  customerId: string;
  name: string;
  phone: string | null;
  locationId: string | null;
  addressLine1: string | null;
  city: string | null;
  hasCoordinates: boolean;
  planFrequency: string | null;
  sameDay: { id: string; windowStart: string; windowEnd: string; status: string; technicianId: string | null; technicianName: string | null; routeId: string | null } | null;
  nextVisit: { id: string; scheduledDate: string; windowStart: string; windowEnd: string; technicianId: string | null; technicianName: string | null; recurring: boolean } | null;
}

/** A stop the office picked for this route (kept locally so Review works without re-fetching). */
interface StopPick {
  appointmentId: string;
  customerId: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  windowStart: string;
  windowEnd: string;
}

const QUICK_TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const QUICK_DURATIONS = [30, 60, 90, 120];

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
  const [stops, setStops] = useState<StopPick[]>([]);
  /** Prompt to put a customer's visit on this route day (move their next visit, or create one). */
  const [prompt, setPrompt] = useState<{ candidate: Candidate; mode: 'move' | 'create' } | null>(null);
  const [promptDate, setPromptDate] = useState<string>('');
  const [promptTime, setPromptTime] = useState<string>('09:00');
  const [promptDuration, setPromptDuration] = useState<number>(60);
  const [promptBusy, setPromptBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const currentUserId = useAuth((s) => s.user)?.id ?? null;

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)), []);

  const { data: techs, isLoading: loadingTechs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api<Tech[]>('/users/technicians'),
  });

  const candidates = useQuery({
    queryKey: ['route-candidates', date, custSearch],
    queryFn: () => api<Candidate[]>(`/routes/candidates?date=${date}&search=${encodeURIComponent(custSearch.trim())}`),
    enabled: step >= STEP_STOPS,
    placeholderData: (prev) => prev,
  });
  const selectedIds = useMemo(() => new Set(stops.map((st) => st.appointmentId)), [stops]);

  const selectedTech = techs?.find((t) => t.employeeId === techId);

  const removeStop = (appointmentId: string) => setStops((cur) => cur.filter((st) => st.appointmentId !== appointmentId));
  const addStop = (pick: StopPick) => setStops((cur) => (cur.some((st) => st.appointmentId === pick.appointmentId) ? cur : [...cur, pick]));

  /** Tap on a customer: toggle their same-day visit, or open the time prompt to bring them onto this day. */
  const onCandidatePress = (c: Candidate) => {
    if (c.sameDay) {
      if (selectedIds.has(c.sameDay.id)) removeStop(c.sameDay.id);
      else addStop({ appointmentId: c.sameDay.id, customerId: c.customerId, name: c.name, addressLine1: c.addressLine1, city: c.city, windowStart: c.sameDay.windowStart, windowEnd: c.sameDay.windowEnd });
      return;
    }
    if (!c.locationId) { notify('No service address', `${c.name} has no service address yet. Add one on the customer screen first.`); return; }
    setPromptDate(date);
    setPromptTime(c.nextVisit?.windowStart?.slice(0, 5) && QUICK_TIMES.includes(c.nextVisit.windowStart.slice(0, 5)) ? c.nextVisit.windowStart.slice(0, 5) : '09:00');
    setPromptDuration(60);
    setPrompt({ candidate: c, mode: c.nextVisit ? 'move' : 'create' });
  };

  /** Move the customer's next visit to the chosen day/time (or create one) and add it as a stop. */
  const confirmPrompt = async () => {
    if (!prompt) return;
    const c = prompt.candidate;
    const windowEnd = addMinutes(promptTime, promptDuration);
    setPromptBusy(true);
    try {
      let appt: { id: string };
      if (prompt.mode === 'move' && c.nextVisit) {
        appt = await api<{ id: string }>(`/appointments/${c.nextVisit.id}/reschedule`, {
          method: 'POST',
          body: { scheduledDate: promptDate, windowStart: promptTime, windowEnd, technicianId: techId ?? c.nextVisit.technicianId ?? null, allowConflict: true },
        });
        appt = { id: c.nextVisit.id };
      } else {
        appt = await api<{ id: string }>('/appointments/quick', {
          method: 'POST',
          body: { customerId: c.customerId, serviceLocationId: c.locationId, technicianId: techId ?? null, scheduledDate: promptDate, windowStart: promptTime, windowEnd, allowConflict: true },
        });
      }
      if (promptDate === date) {
        addStop({ appointmentId: appt.id, customerId: c.customerId, name: c.name, addressLine1: c.addressLine1, city: c.city, windowStart: promptTime, windowEnd });
      } else {
        notify('Visit scheduled', `${c.name} is now on ${fmtDate(promptDate)}. That is a different day than this route, so it was not added as a stop.`);
      }
      void qc.invalidateQueries({ queryKey: ['route-candidates'] });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['customerAppts', c.customerId] });
      setPrompt(null);
    } catch (e) {
      notify('Could not schedule', (e as Error).message);
    } finally {
      setPromptBusy(false);
    }
  };

  const createRoute = async () => {
    if (!techId) { setError('Select a technician.'); return; }
    if (stops.length === 0) { setError('Add at least one stop.'); return; }
    setError('');
    setBusy(true);
    try {
      // 1. Create (or get existing) route for this tech + date
      const route = await api<{ id: string }>('/routes', {
        method: 'POST',
        body: { routeDate: date, technicianId: techId },
      });

      // 2. Add each selected appointment as a stop (in order selected)
      for (const st of stops) {
        try {
          await api(`/routes/${route.id}/stops`, {
            method: 'POST',
            body: { appointmentId: st.appointmentId },
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

      notify('Route Created!', `${stops.length} stop(s) added and optimized.`);
      router.replace(`/route/${route.id}`);
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
          <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.padH}>
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
            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.padH}>
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
                      {t.firstName} {t.lastName}{t.userId === currentUserId ? ' (you)' : ''}
                    </Text>
                    {t.isOwner ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Owner</Text> : null}
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
                if (!techId) { notify('Select a technician first'); return; }
                setStep(STEP_STOPS);
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      )}

      {/* STEP 2: Pick stops — search any customer, pull their visit onto this day */}
      {step === STEP_STOPS && (
        <View style={{ flex: 1 }}>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.search}
              placeholder="Search customers by name, phone or address"
              placeholderTextColor={colors.textMuted}
              value={custSearch}
              onChangeText={setCustSearch}
              autoCorrect={false}
            />
            {custSearch ? <TouchableOpacity onPress={() => setCustSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></TouchableOpacity> : null}
          </View>
          <Text style={styles.hintText}>
            {custSearch.trim() ? 'Tap a customer. A visit already on this day is added; any other visit is moved to this day after you pick a time.' : `Customers with a visit on ${fmtDate(date)}. Search to pull in anyone else.`}
          </Text>

          {stops.length > 0 && (
            <View style={styles.selectedBadge}>
              <Text style={styles.selectedBadgeText}>{stops.length} stop(s) selected</Text>
            </View>
          )}

          {candidates.isLoading ? <Loading /> : (
            <FlatList
              data={candidates.data ?? []}
              keyExtractor={(c) => c.customerId}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.padH}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="people-outline" size={40} color={colors.border} />
                  <Text style={styles.emptyText}>{candidates.error ? `Could not load customers: ${(candidates.error as Error).message}` : custSearch.trim() ? 'No customers match' : 'No visits on this day yet. Search for a customer to add one.'}</Text>
                </View>
              }
              renderItem={({ item }) => {
                const selected = !!item.sameDay && selectedIds.has(item.sameDay.id);
                const onOtherRoute = !!item.sameDay?.routeId;
                return (
                  <TouchableOpacity
                    style={[styles.apptCard, selected && styles.apptCardSelected]}
                    onPress={() => onCandidatePress(item)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.apptCheck}>
                      {selected
                        ? <Ionicons name="checkmark-circle" size={22} color="#2DC4A2" />
                        : item.sameDay
                          ? <View style={styles.unchecked} />
                          : <Ionicons name={item.nextVisit ? 'swap-horizontal' : 'add-circle-outline'} size={22} color={colors.primaryDark} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.apptName, selected && styles.apptNameSelected]}>{item.name}</Text>
                      <Text style={styles.apptAddr}>{item.addressLine1 ? `${item.addressLine1}, ${item.city ?? ''}` : 'No service address'}</Text>
                      {item.sameDay ? (
                        <Text style={styles.apptSvc}>
                          <Text style={{ color: colors.primaryDark, fontWeight: '800' }}>{fmtDate(date)} · {fmtTime(item.sameDay.windowStart)} – {fmtTime(item.sameDay.windowEnd)}</Text>
                          {item.sameDay.technicianName ? ` · ${item.sameDay.technicianName}` : ' · Unassigned'}{onOtherRoute ? ' · already on a route' : ''}
                        </Text>
                      ) : item.nextVisit ? (
                        <Text style={styles.apptSvc}>Next visit {fmtDate(item.nextVisit.scheduledDate)} · {fmtTime(item.nextVisit.windowStart)} – {fmtTime(item.nextVisit.windowEnd)}{item.nextVisit.technicianName ? ` · ${item.nextVisit.technicianName}` : ''} · <Text style={{ color: colors.primaryDark, fontWeight: '800' }}>tap to move to this day</Text></Text>
                      ) : (
                        <Text style={styles.apptSvc}>No upcoming visit{item.planFrequency ? ` · ${item.planFrequency} plan` : ''} · <Text style={{ color: colors.primaryDark, fontWeight: '800' }}>tap to schedule on this day</Text></Text>
                      )}
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
                if (stops.length === 0) { notify('Add at least one stop'); return; }
                setStep(STEP_REVIEW);
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      )}

      {/* STEP 3: Review & create */}
      {step === STEP_REVIEW && (
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.padH, { paddingBottom: 40 }]}>
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
              <Text style={styles.summaryText}>{stops.length} stop(s)</Text>
            </View>
          </View>

          <SectionTitle>Stops</SectionTitle>
          {stops.map((st, i) => (
            <View key={st.appointmentId} style={styles.reviewStop}>
              <View style={styles.stopNum}>
                <Text style={styles.stopNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewName}>{st.name}</Text>
                <Text style={styles.reviewAddr}>{st.addressLine1 ? `${st.addressLine1}, ${st.city ?? ''}` : 'No service address'}</Text>
                <Text style={styles.reviewTime}>{fmtTime(st.windowStart)} – {fmtTime(st.windowEnd)}</Text>
              </View>
              <TouchableOpacity onPress={() => removeStop(st.appointmentId)}>
                <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))}

          <Text style={styles.noteText}>
            Route will be auto-optimized for travel efficiency while respecting appointment windows.
          </Text>

          {error ? <ErrorText message={error} /> : null}

          <Button
            title={`Create Route (${stops.length} stops)`}
            onPress={createRoute}
            loading={busy}
            style={{ marginTop: 12 }}
          />
          <Button title="← Edit Stops" variant="outline" onPress={() => setStep(STEP_STOPS)} />
        </ScrollView>
      )}

      {prompt ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setPrompt(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <Pressable style={styles.promptBackdrop} onPress={() => setPrompt(null)}>
              <Pressable style={styles.promptSheet} onPress={() => undefined}>
                <Text style={styles.promptTitle}>{prompt.candidate.name}</Text>
                <Text style={styles.promptSub}>
                  {prompt.mode === 'move' && prompt.candidate.nextVisit
                    ? `Next visit is ${fmtDate(prompt.candidate.nextVisit.scheduledDate)}, ${fmtTime(prompt.candidate.nextVisit.windowStart)} – ${fmtTime(prompt.candidate.nextVisit.windowEnd)}. Move it and pick a time.`
                    : 'No upcoming visit. Pick a day and time to schedule one.'}
                </Text>
                <Text style={styles.promptLabel}>Day</Text>
                <View style={styles.wrapRow}>
                  {Array.from(new Set([date, todayISO()])).map((d) => (
                    <TouchableOpacity key={d} style={[styles.chip, promptDate === d && styles.chipOn]} onPress={() => setPromptDate(d)}>
                      <Text style={[styles.chipText, promptDate === d && styles.chipTextOn]}>{d === date ? `Route day · ${fmtDate(d)}` : `Today · ${fmtDate(d)}`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {promptDate !== date ? <Text style={styles.promptWarn}>Today is not this route's day, so the visit will be scheduled but not added to this route.</Text> : null}
                <Text style={styles.promptLabel}>Arrival time</Text>
                <View style={styles.wrapRow}>
                  {QUICK_TIMES.map((t) => (
                    <TouchableOpacity key={t} style={[styles.chip, promptTime === t && styles.chipOn]} onPress={() => setPromptTime(t)}>
                      <Text style={[styles.chipText, promptTime === t && styles.chipTextOn]}>{fmtTime(t)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.promptLabel}>Duration</Text>
                <View style={styles.wrapRow}>
                  {QUICK_DURATIONS.map((m) => (
                    <TouchableOpacity key={m} style={[styles.chip, promptDuration === m && styles.chipOn]} onPress={() => setPromptDuration(m)}>
                      <Text style={[styles.chipText, promptDuration === m && styles.chipTextOn]}>{m} min</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.promptSub}>{selectedTech ? `Technician: ${selectedTech.firstName} ${selectedTech.lastName}. ` : ''}{prompt.mode === 'move' ? 'The customer is emailed the new date and time.' : 'The customer is emailed a confirmation.'}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button title="Cancel" variant="outline" onPress={() => setPrompt(null)} style={{ flex: 1 }} />
                  <Button title={prompt.mode === 'move' ? `Move to ${fmtTime(promptTime)}` : `Schedule ${fmtTime(promptTime)}`} onPress={() => void confirmPrompt()} loading={promptBusy} style={{ flex: 1.5 }} />
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hintText: { fontSize: 12, color: colors.textMuted, paddingHorizontal: 16, marginBottom: 6, lineHeight: 16 },
  promptBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  promptSheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  promptTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  promptSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  promptLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  promptWarn: { fontSize: 12, color: '#B3261E', marginTop: 4, lineHeight: 16 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  chipTextOn: { color: '#0D0D0D' },
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
  apptName: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },
  apptNameSelected: { color: '#fff' },
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
