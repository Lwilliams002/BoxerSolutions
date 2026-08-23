import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiRequestError } from '../../src/lib/api';
import { colors, fmtDate, money, todayISO } from '../../src/lib/theme';
import { Button, SectionTitle, ErrorText, Loading } from '../../src/components/ui';

interface Tech {
  employeeId: string;
  firstName: string;
  lastName: string;
}
interface Appointment {
  technicianId: string | null;
  windowStart: string;
  windowEnd: string;
}
interface CustomerRow {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  company: string | null;
  primaryAddress: string | null;
  lastServicedAt: string | null;
}
interface Svc {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
}

const SLOT_START_HOUR = 8;
const SLOT_END_HOUR = 18;
const SLOT_MINUTES = 30;

function nextDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

export default function NewAppointmentScreen() {
  const { customerId: initialCustomerId } = useLocalSearchParams<{ customerId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customerId, setCustomerId] = useState(initialCustomerId ?? '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [date, setDate] = useState(todayISO());
  const [window, setWindow] = useState<string[] | null>(null);
  const [techId, setTechId] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(customerSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const { data: cust, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api<any>(`/customers/${customerId}`),
    enabled: !!customerId,
  });
  const { data: customerResults, isLoading: customersLoading } = useQuery({
    queryKey: ['customersForAppointment', debouncedSearch],
    queryFn: () =>
      api<{ items: CustomerRow[] }>(
        `/customers?${debouncedSearch ? `search=${encodeURIComponent(debouncedSearch)}&` : 'noAppointment=true&'}pageSize=5&sort=created`,
      ),
    enabled: !customerId,
  });
  const { data: techs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api<Tech[]>('/users/technicians'),
  });
  const { data: dayAppointments } = useQuery({
    queryKey: ['appointmentSlots', date],
    queryFn: () => api<{ items: Appointment[] }>(`/appointments?date=${date}&pageSize=500`),
  });
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: () => api<{ items: Svc[] }>('/services?pageSize=100'),
  });

  const days = useMemo(() => nextDays(14), []);
  const windows = useMemo(
    () =>
      Array.from(
        { length: ((SLOT_END_HOUR - SLOT_START_HOUR) * 60) / SLOT_MINUTES },
        (_, i) => {
          const start = SLOT_START_HOUR * 60 + i * SLOT_MINUTES;
          return [timeFromMinutes(start), timeFromMinutes(start + SLOT_MINUTES)];
        },
      ),
    [],
  );
  const selectedCustomerName = cust?.company ?? `${cust?.firstName ?? ''} ${cust?.lastName ?? ''}`.trim();
  const technicians = techs ?? [];
  const appointments = dayAppointments?.items ?? [];
  const windowOptions = useMemo(
    () =>
      windows.map((w) => {
        const hasConflict = techId
          ? appointments.some((appt) => appt.technicianId === techId && overlaps(appt.windowStart, appt.windowEnd, w[0], w[1]))
          : technicians.length > 0
            ? technicians.every((tech) =>
                appointments.some((appt) => appt.technicianId === tech.employeeId && overlaps(appt.windowStart, appt.windowEnd, w[0], w[1])),
              )
            : false;
        return { window: w, available: !hasConflict };
      }),
    [windows, appointments, techId, technicians],
  );

  useEffect(() => {
    if (!window) return;
    const selected = windowOptions.find((opt) => opt.window[0] === window[0] && opt.window[1] === window[1]);
    if (selected && !selected.available) {
      setWindow(null);
    }
  }, [window, windowOptions]);

  const toggleService = (id: string) =>
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const create = async (allowConflict = false) => {
    setError('');
    if (!customerId) {
      setError('Choose a customer.');
      return;
    }
    const location = cust?.serviceLocations?.find((l: any) => l.isPrimary) ?? cust?.serviceLocations?.[0];
    if (!location) {
      setError('Customer has no service location.');
      return;
    }
    if (!window || serviceIds.length === 0) {
      setError('Pick a time window and at least one service.');
      return;
    }
    setBusy(true);
    try {
      const appt = await api<{ id: string }>('/appointments', {
        method: 'POST',
        body: {
          customerId,
          serviceLocationId: location.id,
          technicianId: techId,
          scheduledDate: date,
          windowStart: window[0],
          windowEnd: window[1],
          serviceIds: serviceIds.map((serviceId) => ({ serviceId })),
          allowConflict,
        },
      });
      void qc.invalidateQueries({ queryKey: ['customerAppts', customerId] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      router.replace(`/stop/${appt.id}`);
    } catch (e) {
      const err = e as ApiRequestError;
      if (err.status === 409) {
        Alert.alert('Scheduling Conflict', `${err.message}\n\nSchedule anyway?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Schedule Anyway', style: 'destructive', onPress: () => void create(true) },
        ]);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (customerId && isLoading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle>Customer</SectionTitle>
      {customerId && cust ? (
        <View style={styles.selectedCustomer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.customer}>{selectedCustomerName}</Text>
            {cust.primaryAddress ? <Text style={styles.customerMeta}>{cust.primaryAddress}</Text> : null}
          </View>
          {!initialCustomerId ? (
            <TouchableOpacity style={styles.changeBtn} onPress={() => setCustomerId('')}>
              <Text style={styles.changeBtnText}>Change</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={customerSearch}
            onChangeText={setCustomerSearch}
            placeholder="Search customers"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          {customersLoading ? <Loading /> : null}
          {!customersLoading && !(customerResults?.items ?? []).length ? (
            <Text style={styles.customerRowMeta}>No pending customers found.</Text>
          ) : null}
          {(customerResults?.items ?? []).map((c) => (
            <TouchableOpacity key={c.id} style={styles.customerRow} onPress={() => setCustomerId(c.id)}>
              <Text style={styles.customerRowName}>{c.company ?? `${c.firstName} ${c.lastName}`}</Text>
              <Text style={styles.customerRowMeta}>
                {c.primaryAddress ?? `#${c.customerNumber}`}
              </Text>
              <Text style={styles.customerRowMeta}>
                {c.lastServicedAt ? `Last serviced ${fmtDate(c.lastServicedAt)}` : 'Never serviced'}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <SectionTitle>Technician</SectionTitle>
      <View style={styles.wrapRow}>
        {(techs ?? []).map((t) => (
          <TouchableOpacity
            key={t.employeeId}
            style={[styles.chip, techId === t.employeeId && styles.chipActive]}
            onPress={() => setTechId(techId === t.employeeId ? null : t.employeeId)}
          >
            <Text style={[styles.chipText, techId === t.employeeId && styles.chipTextActive]}>
              {t.firstName} {t.lastName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionTitle>Date</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {days.map((d) => (
          <TouchableOpacity key={d} style={[styles.chip, date === d && styles.chipActive]} onPress={() => setDate(d)}>
            <Text style={[styles.chipText, date === d && styles.chipTextActive]}>
              {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <SectionTitle>Time Window</SectionTitle>
      <View style={styles.wrapRow}>
        {windowOptions.map(({ window: w, available }) => (
          <TouchableOpacity
            key={w[0]}
            style={[
              styles.chip,
              window?.[0] === w[0] && styles.chipActive,
              !available && styles.chipDisabled,
            ]}
            onPress={() => available && setWindow(w)}
            disabled={!available}
          >
            <Text
              style={[
                styles.chipText,
                window?.[0] === w[0] && styles.chipTextActive,
                !available && styles.chipTextDisabled,
              ]}
            >
              {w[0]} – {w[1]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionTitle>Services</SectionTitle>
      {(services?.items ?? []).map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.serviceRow, serviceIds.includes(s.id) && styles.serviceRowActive]}
          onPress={() => toggleService(s.id)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.serviceName}>{s.name}</Text>
            <Text style={styles.serviceMeta}>{s.durationMinutes} min</Text>
          </View>
          <Text style={styles.servicePrice}>{money(s.price)}</Text>
        </TouchableOpacity>
      ))}

      {error ? <ErrorText message={error} /> : null}
      <Button title="Create Appointment" onPress={() => create()} loading={busy} style={{ marginTop: 16 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  customer: { fontSize: 18, fontWeight: '800', color: colors.text },
  customerMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  selectedCustomer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.bg,
  },
  changeBtnText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 8,
  },
  customerRow: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  customerRowName: { fontSize: 15, fontWeight: '800', color: colors.text },
  customerRowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '800' },
  chipDisabled: { backgroundColor: '#F2F5F4', borderColor: '#E0E8E6', opacity: 0.55 },
  chipTextDisabled: { color: colors.textMuted },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  serviceRowActive: { borderColor: colors.primary, borderWidth: 2 },
  serviceName: { fontSize: 15, fontWeight: '600', color: colors.text },
  serviceMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  servicePrice: { fontSize: 15, fontWeight: '700', color: colors.text },
});
