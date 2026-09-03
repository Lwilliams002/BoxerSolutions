import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { Button, Card, StatusBadge } from '../../src/components/ui';
import { colors, fmtDate, money } from '../../src/lib/theme';
import { OwnerServiceRequest, Paginated } from '../../src/lib/types';

interface Tech {
  employeeId: string;
  firstName: string;
  lastName: string;
}

const START_HOUR = 8;
const END_HOUR = 18;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatHourLabel(hour24: number) {
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:00 ${hour24 < 12 ? 'AM' : 'PM'}`;
}

function hourWindow(hour24: number) {
  const endHour = Math.min(hour24 + 1, END_HOUR);
  return {
    start: `${pad2(hour24)}:00`,
    end: `${pad2(endHour)}:00`,
    label: `${formatHourLabel(hour24)} – ${formatHourLabel(endHour)}`,
  };
}

function dateFromIso(iso?: string) {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date();
  dt.setFullYear(y || dt.getFullYear(), (m || 1) - 1, d || 1);
  dt.setHours(12, 0, 0, 0);
  return dt;
}

function dateToIso(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeFromWindow(start?: string) {
  const dt = new Date();
  const [h = '08', m = '00'] = String(start ?? '08:00').split(':');
  dt.setHours(Number(h), Number(m), 0, 0);
  return dt;
}

function snapToHourWindow(date: Date) {
  let hour = date.getMinutes() >= 30 ? date.getHours() + 1 : date.getHours();
  if (hour < START_HOUR) hour = START_HOUR;
  if (hour >= END_HOUR) hour = END_HOUR - 1;
  return hourWindow(hour);
}

export default function ServiceRequestsAdminScreen() {
  const qc = useQueryClient();
  const canManage = useAuth((s) => s.hasPermission('users:write', 'appointments:write'));
  const [quotedById, setQuotedById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [techById, setTechById] = useState<Record<string, string | null>>({});
  const [dateById, setDateById] = useState<Record<string, string>>({});
  const [windowById, setWindowById] = useState<Record<string, { start: string; end: string } | null>>({});
  const [picker, setPicker] = useState<{ requestId: string; mode: 'date' | 'time' } | null>(null);

  const requests = useQuery({
    queryKey: ['owner-service-requests'],
    queryFn: () => api<Paginated<OwnerServiceRequest>>('/service-requests?page=1&pageSize=50'),
    enabled: canManage,
  });
  const technicians = useQuery({
    queryKey: ['owner-techs'],
    queryFn: () => api<Tech[]>('/users/technicians'),
    enabled: canManage,
  });

  const update = useMutation({
    mutationFn: async (requestId: string) => {
      const selectedTech = techById[requestId];
      const quotedRaw = quotedById[requestId];
      const notes = notesById[requestId];
      const quotedPrice = quotedRaw && quotedRaw.trim() ? Number(quotedRaw) : null;
      if (quotedRaw && (!Number.isFinite(quotedPrice) || quotedPrice! < 0)) {
        throw new Error('Quoted price must be a valid number.');
      }
      const date = (dateById[requestId] ?? '').trim();
      const window = windowById[requestId] ?? null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Visit date must look like 2026-09-15.');
      }
      if (date && !window) throw new Error('Pick a time window for the visit.');
      if (!date && window) throw new Error('Enter a visit date for the selected time window.');

      const body: Record<string, unknown> = {
        assignedTechnicianId: selectedTech ?? null,
        quotedPrice,
        ownerNotes: notes?.trim() ? notes.trim() : null,
      };
      if (date && window) {
        // Scheduling creates a real appointment: it appears in the schedule
        // and the customer sees the visit in their portal.
        body.scheduledDate = date;
        body.windowStart = window.start;
        body.windowEnd = window.end;
      } else {
        body.status = 'reviewed';
      }
      await api(`/service-requests/${requestId}`, { method: 'PATCH', body });
      return Boolean(date && window);
    },
    onSuccess: async (scheduled) => {
      await qc.invalidateQueries({ queryKey: ['owner-service-requests'] });
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      Alert.alert(
        scheduled ? 'Visit scheduled' : 'Saved',
        scheduled
          ? 'An appointment was created — it is on the schedule and visible to the customer.'
          : 'Service request updated.',
      );
    },
    onError: (e) => Alert.alert('Unable to update request', (e as Error).message),
  });

  const pickTech = (requestId: string) => {
    const options = (technicians.data ?? []).slice(0, 8).map((t) => ({
      text: `${t.firstName} ${t.lastName}`,
      onPress: () => setTechById((prev) => ({ ...prev, [requestId]: t.employeeId })),
    }));
    Alert.alert('Assign technician', 'Choose who should handle this request.', [
      ...options,
      { text: 'Unassign', onPress: () => setTechById((prev) => ({ ...prev, [requestId]: null })) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (!picker) return;
    if (event.type === 'dismissed') {
      setPicker(null);
      return;
    }
    if (!value) return;
    if (picker.mode === 'date') {
      setDateById((prev) => ({ ...prev, [picker.requestId]: dateToIso(value) }));
    } else {
      const nextWindow = snapToHourWindow(value);
      setWindowById((prev) => ({ ...prev, [picker.requestId]: { start: nextWindow.start, end: nextWindow.end } }));
    }
    if (Platform.OS !== 'ios') setPicker(null);
  };

  const rows = useMemo(() => requests.data?.items ?? [], [requests.data?.items]);

  if (!canManage) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.customer}>Access restricted</Text>
          <Text style={styles.meta}>You do not have permission to review service requests.</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {rows.map((r) => {
        const selectedTech = techById[r.id] ?? r.assigned_technician_id ?? null;
        const selectedTechName = (technicians.data ?? []).find((t) => t.employeeId === selectedTech);
        const quoteText = quotedById[r.id] ?? (r.quoted_price != null ? String(Number(r.quoted_price).toFixed(2)) : '');
        const notesText = notesById[r.id] ?? (r.owner_notes ?? '');
        const dateText = dateById[r.id] ?? '';
        const selectedWindow = windowById[r.id] ?? null;
        const alreadyScheduled = Boolean(r.appointment_id);
        const selectedWindowLabel = selectedWindow
          ? `${formatHourLabel(Number(selectedWindow.start.slice(0, 2)))} – ${formatHourLabel(Number(selectedWindow.end.slice(0, 2)))}`
          : null;
        return (
          <Card key={r.id}>
            <View style={styles.rowHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer}>{r.customer_name}</Text>
                <Text style={styles.meta}>{r.customer_email ?? 'No email'} · {r.customer_phone ?? 'No phone'}</Text>
                <Text style={styles.meta}>{fmtDate(r.requested_at)} · {r.files.length} photo(s)</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
            <Text style={styles.desc}>{r.description}</Text>
            {alreadyScheduled ? (
              <Text style={styles.scheduledBanner}>
                Visit scheduled: {fmtDate(r.scheduled_date)} · {String(r.window_start ?? '').slice(0, 5)}–{String(r.window_end ?? '').slice(0, 5)}
              </Text>
            ) : null}
            <TouchableOpacity style={styles.assignBtn} onPress={() => pickTech(r.id)}>
              <Text style={styles.assignText}>
                {selectedTechName ? `Tech: ${selectedTechName.firstName} ${selectedTechName.lastName}` : 'Assign Technician'}
              </Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={quoteText}
              onChangeText={(text) => setQuotedById((prev) => ({ ...prev, [r.id]: text }))}
              keyboardType="decimal-pad"
              placeholder="Quoted price (e.g. 129.00)"
              placeholderTextColor={colors.textMuted}
            />
            {quoteText ? <Text style={styles.quotePreview}>Quote: {money(quoteText)}</Text> : null}
            {!alreadyScheduled ? (
              <>
                <View style={styles.pickerRow}>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setPicker({ requestId: r.id, mode: 'date' })}>
                    <Text style={styles.pickerLabel}>Visit Date</Text>
                    <Text style={styles.pickerValue}>{dateText ? fmtDate(dateText) : 'Pick a date'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setPicker({ requestId: r.id, mode: 'time' })}>
                    <Text style={styles.pickerLabel}>Visit Time</Text>
                    <Text style={styles.pickerValue}>{selectedWindowLabel ?? 'Pick a time'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.intervalHint}>Time selections snap to 1-hour intervals between 8:00 AM and 6:00 PM.</Text>
              </>
            ) : null}
            <TextInput
              style={[styles.input, styles.notes]}
              value={notesText}
              onChangeText={(text) => setNotesById((prev) => ({ ...prev, [r.id]: text }))}
              placeholder="Owner notes"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <Button
              title={dateText && selectedWindow ? 'Schedule Visit' : 'Save Assignment'}
              onPress={() => update.mutate(r.id)}
              loading={update.isPending}
            />
          </Card>
        );
      })}
      {requests.isLoading ? <Text style={styles.loading}>Loading requests...</Text> : null}
      {!requests.isLoading && !rows.length ? <Text style={styles.loading}>No service requests yet.</Text> : null}
      {picker ? (
        <View style={styles.pickerDock}>
          <Card>
            <Text style={styles.pickerDockTitle}>{picker.mode === 'date' ? 'Select visit date' : 'Select visit time'}</Text>
            <DateTimePicker
              value={picker.mode === 'date' ? dateFromIso(dateById[picker.requestId]) : timeFromWindow(windowById[picker.requestId]?.start)}
              mode={picker.mode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minuteInterval={picker.mode === 'time' ? 30 : 1}
              onChange={onPickerChange}
            />
            {Platform.OS === 'ios' ? (
              <Button title="Done" onPress={() => setPicker(null)} />
            ) : null}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 24 },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  customer: { color: colors.text, fontWeight: '800', fontSize: 16 },
  meta: { color: colors.textMuted, marginTop: 2, fontSize: 12 },
  desc: { color: colors.text, marginTop: 10, marginBottom: 10 },
  assignBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  assignText: { color: colors.text, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  quotePreview: { color: colors.success, fontWeight: '700', marginBottom: 8 },
  scheduledBanner: { color: colors.primaryDark, fontWeight: '800', marginBottom: 8 },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pickerBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  pickerLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 3, textTransform: 'uppercase' },
  pickerValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  intervalHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  pickerDock: { marginTop: 12 },
  pickerDockTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  loading: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
});
