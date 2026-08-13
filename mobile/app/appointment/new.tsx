import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiRequestError } from '../../src/lib/api';
import { colors, money, todayISO } from '../../src/lib/theme';
import { Button, SectionTitle, ErrorText, Loading } from '../../src/components/ui';

interface Tech {
  employeeId: string;
  firstName: string;
  lastName: string;
}
interface Svc {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
}

const WINDOWS = [
  ['08:00', '10:00'],
  ['10:00', '12:00'],
  ['12:00', '14:00'],
  ['14:00', '16:00'],
  ['16:00', '18:00'],
];

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

export default function NewAppointmentScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(todayISO());
  const [window, setWindow] = useState<string[] | null>(null);
  const [techId, setTechId] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  const { data: cust, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api<any>(`/customers/${customerId}`),
  });
  const { data: techs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api<Tech[]>('/users/technicians'),
  });
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: () => api<{ items: Svc[] }>('/services?pageSize=100'),
  });

  const days = useMemo(() => nextDays(14), []);

  const toggleService = (id: string) =>
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const create = async (allowConflict = false) => {
    setError('');
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

  if (isLoading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.customer}>
        {cust?.company ?? `${cust?.firstName} ${cust?.lastName}`}
      </Text>

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
        {WINDOWS.map((w) => (
          <TouchableOpacity
            key={w[0]}
            style={[styles.chip, window?.[0] === w[0] && styles.chipActive]}
            onPress={() => setWindow(w)}
          >
            <Text style={[styles.chipText, window?.[0] === w[0] && styles.chipTextActive]}>
              {w[0]} – {w[1]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
