import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiRequestError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, fmtDate, fmtTime, statusColors, todayISO } from '../../src/lib/theme';
import { EmptyState, Loading, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { MonthWeekPicker } from '../../src/components/MonthWeekPicker';

type ViewMode = 'day' | 'week';
type EditorMode = 'actions' | 'reschedule' | 'reassign';

interface Technician {
  employeeId: string;
  firstName: string;
  lastName: string;
  color: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
}

interface Appointment {
  id: string;
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  customerCompany: string | null;
  addressLine1: string;
  city: string;
  status: string;
  scheduledDate: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number | null;
  technicianId: string | null;
  technicianName: string | null;
  services: { name: string; durationMinutes?: number | null }[] | null;
}

interface ListResponse<T> { items: T[]; page: number; pageSize: number; total: number }
interface Lane { id: string | null; name: string; color: string }
interface RescheduleBody { scheduledDate: string; windowStart: string; windowEnd: string; technicianId?: string | null; allowConflict?: boolean }

const START_HOUR = 7;
const END_HOUR = 19;
const HOUR_HEIGHT = 92;
const LANE_WIDTH = 178;
const AXIS_WIDTH = 74;
const BOARD_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const QUICK_TIMES = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const QUICK_DURATIONS = [30, 60, 90, 120];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesOf(t?: string | null): number {
  if (!t) return START_HOUR * 60;
  const [h = START_HOUR, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function customerName(a: Appointment): string {
  return a.customerCompany ?? `${a.customerFirstName} ${a.customerLastName}`;
}

function conflictMessage(err: ApiRequestError): string {
  const data = err.data as { conflicts?: { windowStart?: string; windowEnd?: string; firstName?: string; lastName?: string }[] } | null;
  const conflicts = data?.conflicts ?? [];
  if (!conflicts.length) return err.message;
  return `${err.message}\n\n${conflicts.map((c) => `${fmtTime(c.windowStart)}–${fmtTime(c.windowEnd)} ${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()).join('\n')}`;
}

function isWriteError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError || (typeof e === 'object' && e !== null && 'status' in e);
}

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const canWrite = hasPermission('appointments:write');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [mode, setMode] = useState<ViewMode>('week');
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('actions');
  const [editDate, setEditDate] = useState(selectedDate);
  const [editStart, setEditStart] = useState('08:00');
  const [editDuration, setEditDuration] = useState('60');
  const [editTechId, setEditTechId] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)), []);
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const appointmentsQuery = useQuery({
    queryKey: ['schedule', selectedDate],
    queryFn: () => api<ListResponse<Appointment>>(`/appointments?date=${selectedDate}&pageSize=500`),
  });
  const techQuery = useQuery({ queryKey: ['technicians'], queryFn: () => api<Technician[]>('/users/technicians') });
  const weekQuery = useQuery({
    queryKey: ['schedule-week', weekStart],
    queryFn: () => api<ListResponse<Appointment>>(`/appointments?from=${weekStart}&to=${addDays(weekStart, 6)}&pageSize=700`),
    enabled: mode === 'week',
  });

  const technicians = techQuery.data ?? [];
  const lanes: Lane[] = useMemo(() => [
    { id: null, name: 'Unassigned', color: colors.textMuted },
    ...technicians.map((t) => ({ id: t.employeeId, name: `${t.firstName} ${t.lastName}`, color: t.color ?? colors.primary })),
  ], [technicians]);
  const appointments = useMemo(
    () => (appointmentsQuery.data?.items ?? []).slice().sort((a, b) => a.windowStart.localeCompare(b.windowStart)),
    [appointmentsQuery.data?.items],
  );

  const reschedule = useMutation({
    mutationFn: ({ id, body }: { id: string; body: RescheduleBody }) => api<Appointment>(`/appointments/${id}/reschedule`, { method: 'POST', body }),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['schedule'] }),
        qc.invalidateQueries({ queryKey: ['schedule-week'] }),
        qc.invalidateQueries({ queryKey: ['appointment'] }),
      ]);
    },
    onError: (e, vars) => {
      const err = isWriteError(e) ? e as ApiRequestError : new ApiRequestError((e as Error).message, 0);
      if (err.status === 409) {
        Alert.alert('Scheduling Conflict', `${conflictMessage(err)}\n\nOverride this conflict?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Override', style: 'destructive', onPress: () => reschedule.mutate({ id: vars.id, body: { ...vars.body, allowConflict: true } }) },
        ]);
      } else {
        Alert.alert('Unable to update appointment', err.message);
      }
    },
  });

  const openAppointment = (appt: Appointment) => {
    setSelected(appt);
    setEditorMode('actions');
    setEditDate(appt.scheduledDate);
    setEditStart(appt.windowStart.slice(0, 5));
    setEditDuration(String(Math.max(30, minutesOf(appt.windowEnd) - minutesOf(appt.windowStart))));
    setEditTechId(appt.technicianId ?? null);
  };

  const closeAndGo = (path: string) => {
    setSelected(null);
    setTimeout(() => router.push(path as never), 300);
  };

  const submitReschedule = (techOverride?: string | null) => {
    if (!selected) return;
    const start = minutesOf(editStart);
    const duration = Math.max(15, Number.parseInt(editDuration, 10) || 60);
    reschedule.mutate({
      id: selected.id,
      body: {
        scheduledDate: editDate,
        windowStart: timeFromMinutes(start),
        windowEnd: timeFromMinutes(start + duration),
        technicianId: techOverride !== undefined ? techOverride : editTechId,
      },
    });
  };

  const refresh = () => {
    void appointmentsQuery.refetch();
    if (mode === 'week') void weekQuery.refetch();
    void techQuery.refetch();
  };

  const changeDate = (date: string) => {
    setSelectedDate(date);
    setMode('day');
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <View style={styles.headerToggleRow}>
            {(['day', 'week'] as ViewMode[]).map((m) => (
              <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeActive]} onPress={() => setMode(m)}>
                <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'day' ? 'Day Board' : 'Week View'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {canWrite ? (
          <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/appointment/new')}>
            <Ionicons name="add" size={18} color={colors.text} />
            <Text style={styles.createBtnText}>New Appointment</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <MonthWeekPicker value={selectedDate} onChange={changeDate} />

      <SyncBanner />

      {appointmentsQuery.isLoading || techQuery.isLoading ? <Loading /> : mode === 'week' ? (
        <WeekView
          days={weekDays}
          appointments={weekQuery.data?.items ?? []}
          loading={weekQuery.isLoading}
          refreshing={weekQuery.isRefetching || appointmentsQuery.isRefetching}
          onRefresh={refresh}
          onDayPress={(d) => { setSelectedDate(d); setMode('day'); }}
          onAppointmentPress={openAppointment}
        />
      ) : (
        <DayBoard
          appointments={appointments}
          lanes={lanes}
          refreshing={appointmentsQuery.isRefetching || techQuery.isRefetching}
          onRefresh={refresh}
          onAppointmentPress={openAppointment}
        />
      )}

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            {selected ? (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{customerName(selected)}</Text>
                    <Text style={styles.sheetSub}>{fmtTime(selected.windowStart)} – {fmtTime(selected.windowEnd)} · {selected.technicianName ?? 'Unassigned'}</Text>
                  </View>
                  <StatusBadge status={selected.status} />
                </View>

                {editorMode === 'actions' ? (
                  <View>
                    <TouchableOpacity style={styles.actionRow} onPress={() => closeAndGo(`/stop/${selected.id}`)}>
                      <Ionicons name="clipboard-outline" size={20} color={colors.primaryDark} />
                      <Text style={styles.actionText}>View appointment details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionRow} onPress={() => closeAndGo(`/customer/${selected.customerId}`)}>
                      <Ionicons name="person-outline" size={20} color={colors.primaryDark} />
                      <Text style={styles.actionText}>Open customer</Text>
                    </TouchableOpacity>
                    {canWrite ? (
                      <>
                        <TouchableOpacity style={styles.actionRow} onPress={() => setEditorMode('reschedule')}>
                          <Ionicons name="time-outline" size={20} color={colors.primaryDark} />
                          <Text style={styles.actionText}>Reschedule</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionRow} onPress={() => setEditorMode('reassign')}>
                          <Ionicons name="swap-horizontal-outline" size={20} color={colors.primaryDark} />
                          <Text style={styles.actionText}>Reassign technician</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                ) : editorMode === 'reschedule' ? (
                  <View>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.editDayBar} contentContainerStyle={{ alignItems: 'center' }}>
                      {days.map((d) => (
                        <TouchableOpacity key={d} style={[styles.editChip, editDate === d && styles.editChipActive]} onPress={() => setEditDate(d)}>
                          <Text style={[styles.editChipText, editDate === d && styles.editChipTextActive]}>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={styles.fieldLabel}>Start time</Text>
                    <View style={styles.wrapRow}>{QUICK_TIMES.map((t) => <Choice key={t} label={fmtTime(t)} active={editStart === t} onPress={() => setEditStart(t)} />)}</View>
                    <View style={styles.inputRow}>
                      <TextInput value={editStart} onChangeText={setEditStart} style={styles.input} placeholder="HH:MM" />
                      <TextInput value={editDuration} onChangeText={setEditDuration} style={styles.input} keyboardType="number-pad" placeholder="Minutes" />
                    </View>
                    <Text style={styles.fieldLabel}>Duration</Text>
                    <View style={styles.wrapRow}>{QUICK_DURATIONS.map((m) => <Choice key={m} label={`${m} min`} active={editDuration === String(m)} onPress={() => setEditDuration(String(m))} />)}</View>
                    <TouchableOpacity style={styles.saveBtn} onPress={() => submitReschedule()} disabled={reschedule.isPending}>
                      <Text style={styles.saveBtnText}>{reschedule.isPending ? 'Saving…' : 'Save new time'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.fieldLabel}>Assign to</Text>
                    <TouchableOpacity style={[styles.techOption, editTechId === null && styles.techOptionActive]} onPress={() => setEditTechId(null)}>
                      <Text style={styles.techOptionName}>Unassigned</Text>
                    </TouchableOpacity>
                    {technicians.map((t) => (
                      <TouchableOpacity key={t.employeeId} style={[styles.techOption, editTechId === t.employeeId && styles.techOptionActive]} onPress={() => setEditTechId(t.employeeId)}>
                        <View style={[styles.techDot, { backgroundColor: t.color ?? colors.primary }]} />
                        <Text style={styles.techOptionName}>{t.firstName} {t.lastName}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={styles.saveBtn} onPress={() => submitReschedule(editTechId)} disabled={reschedule.isPending}>
                      <Text style={styles.saveBtnText}>{reschedule.isPending ? 'Saving…' : 'Save assignment'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity style={styles.closeBtn} onPress={() => editorMode === 'actions' ? setSelected(null) : setEditorMode('actions')}>
                  <Text style={styles.closeText}>{editorMode === 'actions' ? 'Close' : 'Back'}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.editChip, active && styles.editChipActive]} onPress={onPress}>
      <Text style={[styles.editChipText, active && styles.editChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DayBoard({ appointments, lanes, refreshing, onRefresh, onAppointmentPress }: {
  appointments: Appointment[];
  lanes: Lane[];
  refreshing: boolean;
  onRefresh: () => void;
  onAppointmentPress: (appt: Appointment) => void;
}) {
  if (!appointments.length) {
    return (
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />} contentContainerStyle={styles.emptyWrap}>
        <EmptyState title="No appointments" subtitle="Nothing scheduled for this day." />
      </ScrollView>
    );
  }

  const laneData = lanes.map((lane) => {
    const laneAppointments = appointments
      .filter((a) => (a.technicianId ?? null) === lane.id)
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
    return {
      ...lane,
      appointments: laneAppointments,
      nextLabel: laneAppointments[0]
        ? `${fmtTime(laneAppointments[0].windowStart)} · ${customerName(laneAppointments[0])}`
        : 'Open',
    };
  });

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daySummaryRail}>
        {laneData.map((lane) => (
          <View key={lane.id ?? 'unassigned'} style={styles.daySummaryCard}>
            <View style={styles.daySummaryTop}>
              <View style={[styles.techDot, { backgroundColor: lane.color }]} />
              <Text style={styles.daySummaryName} numberOfLines={1}>{lane.name}</Text>
            </View>
            <Text style={styles.daySummaryCount}>{lane.appointments.length} appointment{lane.appointments.length === 1 ? '' : 's'}</Text>
            <Text style={styles.daySummaryMeta} numberOfLines={1}>{lane.nextLabel}</Text>
          </View>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.boardScroll}>
        <View style={styles.axisColumn}>
          <View style={styles.laneHeaderSpacer} />
          <View style={styles.axisBody}>
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i).map((h) => (
              <Text key={h} style={[styles.axisTime, { top: (h - START_HOUR) * HOUR_HEIGHT - 8 }]}>{fmtTime(`${String(h).padStart(2, '0')}:00`)}</Text>
            ))}
          </View>
        </View>
        {laneData.map((lane) => (
          <LaneColumn
            key={lane.id ?? 'unassigned'}
            lane={lane}
            appointments={lane.appointments}
            onAppointmentPress={onAppointmentPress}
          />
        ))}
      </ScrollView>
    </ScrollView>
  );
}

function LaneColumn({ lane, appointments, onAppointmentPress }: { lane: Lane; appointments: Appointment[]; onAppointmentPress: (appt: Appointment) => void }) {
  return (
    <View style={styles.lane}>
      <View style={styles.laneHeader}>
        <View style={[styles.techDot, { backgroundColor: lane.color }]} />
        <Text style={styles.laneTitle}>{lane.name}</Text>
        <Text style={styles.laneCount}>{appointments.length}</Text>
      </View>
      <View style={styles.laneBody}>
        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => <View key={i} style={[styles.hourLine, { top: i * HOUR_HEIGHT }]} />)}
        {appointments.map((appt) => {
          const top = Math.max(0, (minutesOf(appt.windowStart) - START_HOUR * 60) / 60 * HOUR_HEIGHT);
          const minutes = Math.max(30, minutesOf(appt.windowEnd) - minutesOf(appt.windowStart) || appt.durationMinutes || 60);
          const height = Math.max(54, minutes / 60 * HOUR_HEIGHT - 4);
          const color = statusColors[appt.status] ?? colors.textMuted;
          return (
            <TouchableOpacity key={appt.id} activeOpacity={0.82} style={[styles.apptBlock, { top, height, borderLeftColor: color }]} onPress={() => onAppointmentPress(appt)}>
              <Text style={styles.apptTime}>{fmtTime(appt.windowStart)} – {fmtTime(appt.windowEnd)}</Text>
              <Text style={styles.apptName} numberOfLines={2}>{customerName(appt)}</Text>
              <Text style={styles.apptMeta} numberOfLines={1}>{appt.services?.map((s) => s.name).join(', ') || appt.addressLine1}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function WeekView({ days, appointments, loading, refreshing, onRefresh, onDayPress, onAppointmentPress }: {
  days: string[];
  appointments: Appointment[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDayPress: (day: string) => void;
  onAppointmentPress: (appt: Appointment) => void;
}) {
  if (loading) return <Loading />;
  return (
    <ScrollView contentContainerStyle={styles.weekWrap} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      {days.map((day) => {
        const dayKey = day.slice(0, 10);
        const dayItems = appointments
          .filter((a) => String(a.scheduledDate).slice(0, 10) === dayKey)
          .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
        const grouped = dayItems.reduce<Record<string, Appointment[]>>((acc, a) => {
          const key = a.technicianName ?? 'Unassigned';
          acc[key] = acc[key] ? [...acc[key], a] : [a];
          return acc;
        }, {});
        return (
          <TouchableOpacity key={day} style={styles.weekCard} activeOpacity={0.9} onPress={() => onDayPress(day)}>
            <View style={styles.weekTop}>
              <View>
                <Text style={styles.weekDay}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</Text>
                <Text style={styles.weekDate}>{fmtDate(day)}</Text>
              </View>
              <View style={styles.countPill}><Text style={styles.countText}>{dayItems.length}</Text></View>
            </View>
            {dayItems.length === 0 ? <Text style={styles.weekEmpty}>No appointments</Text> : Object.entries(grouped).map(([tech, items]) => (
              <View key={tech} style={styles.weekGroup}>
                <Text style={styles.weekTech}>{tech} · {items.length}</Text>
                {items.slice(0, 3).map((a) => (
                  <TouchableOpacity key={a.id} style={styles.weekAppt} onPress={(e) => { e.stopPropagation(); onAppointmentPress(a); }}>
                    <Text style={styles.weekApptText} numberOfLines={1}>{fmtTime(a.windowStart)} {customerName(a)}</Text>
                    <StatusBadge status={a.status} />
                  </TouchableOpacity>
                ))}
                {items.length > 3 ? <Text style={styles.moreText}>+{items.length - 3} more</Text> : null}
              </View>
            ))}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14 },
  headerToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  createBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 12, maxWidth: 144 },
  createBtnText: { color: colors.text, fontWeight: '900', fontSize: 11, marginLeft: 4 },
  modeBtn: { height: 32, paddingHorizontal: 10, borderRadius: 16, justifyContent: 'center', marginRight: 0, backgroundColor: '#1D1D1D' },
  modeActive: { backgroundColor: colors.primary },
  modeText: { color: '#fff', fontWeight: '800', fontSize: 11, lineHeight: 14 },
  modeTextActive: { color: colors.text },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  boardScroll: { padding: 12, paddingBottom: 32 },
  axisColumn: { width: AXIS_WIDTH },
  laneHeaderSpacer: { height: 48 },
  axisBody: { height: BOARD_HEIGHT, position: 'relative' },
  axisTime: { position: 'absolute', left: 0, right: 8, fontSize: 11, lineHeight: 14, color: colors.textMuted, fontWeight: '800', textAlign: 'right' },
  lane: { width: LANE_WIDTH, marginRight: 10 },
  laneHeader: { height: 48, backgroundColor: colors.text, borderTopLeftRadius: 14, borderTopRightRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  laneTitle: { color: '#fff', flex: 1, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  laneCount: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  techDot: { width: 10, height: 10, borderRadius: 5, marginRight: 7 },
  laneBody: { height: BOARD_HEIGHT, backgroundColor: '#FFFFFF', borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, position: 'relative', overflow: 'hidden' },
  hourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.border },
  apptBlock: { position: 'absolute', left: 6, right: 6, backgroundColor: '#F7FFFD', borderRadius: 12, borderLeftWidth: 5, borderWidth: 1, borderColor: colors.border, padding: 8, shadowColor: colors.text, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 },
  apptTime: { color: colors.primaryDark, fontSize: 11, lineHeight: 14, fontWeight: '900' },
  apptName: { color: colors.text, fontSize: 13, lineHeight: 16, fontWeight: '900', marginTop: 2 },
  apptMeta: { color: colors.textMuted, fontSize: 11, lineHeight: 14, marginTop: 2 },
  weekWrap: { padding: 14, paddingBottom: 40 },
  daySummaryRail: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  daySummaryCard: {
    width: 162,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginRight: 10,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  daySummaryTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  daySummaryName: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  daySummaryCount: { color: colors.primaryDark, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  daySummaryMeta: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  weekCard: { backgroundColor: colors.card, borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border, shadowColor: colors.text, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  weekTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  weekDay: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  weekDate: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 1 },
  countPill: { minWidth: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  weekEmpty: { color: colors.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  weekGroup: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, marginTop: 8 },
  weekTech: { color: colors.primaryDark, fontSize: 12, lineHeight: 16, fontWeight: '900', marginBottom: 4 },
  weekAppt: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekApptText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700', marginRight: 8 },
  moreText: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 2 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13,13,13,0.45)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: '86%' },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 14 },
  sheetTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  sheetTitle: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  sheetSub: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', marginLeft: 10 },
  closeBtn: { alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, backgroundColor: colors.bg, marginTop: 12 },
  closeText: { color: colors.primaryDark, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  fieldLabel: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 10, marginBottom: 8 },
  editDayBar: { flexGrow: 0, height: 42 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  editChip: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', justifyContent: 'center', marginRight: 8, marginBottom: 8 },
  editChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  editChipText: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700' },
  editChipTextActive: { color: colors.text, fontWeight: '900' },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, height: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontWeight: '800', backgroundColor: colors.bg },
  saveBtn: { height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  saveBtnText: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  techOption: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 },
  techOptionActive: { borderColor: colors.primary, backgroundColor: '#E8FBF6' },
  techOptionName: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800' },
});
