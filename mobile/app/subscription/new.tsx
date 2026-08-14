import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, fmtDate, fmtTime, money, todayISO } from '../../src/lib/theme';
import { Button, Card, ErrorText, Label, Loading, Row, SectionTitle, StatusBadge, Value } from '../../src/components/ui';

interface Tech { employeeId: string; firstName: string; lastName: string }
interface Svc { id: string; name: string; price: string; durationMinutes: number }
interface Customer { id: string; firstName: string; lastName: string; company?: string | null; primaryAddress?: string }

const FREQUENCIES = [
  ['weekly', 'Weekly'], ['biweekly', 'Biweekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['custom', 'Custom days'],
] as const;

export default function NewSubscriptionScreen() {
  const { customerId: initialCustomerId } = useLocalSearchParams<{ customerId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState(initialCustomerId ?? '');
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number][0]>('monthly');
  const [customDays, setCustomDays] = useState('30');
  const [startDate, setStartDate] = useState(todayISO());
  const [preferredTime, setPreferredTime] = useState('09:00');
  const [techId, setTechId] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<any | null>(null);

  const { data: customers } = useQuery({ queryKey: ['customersForPlan'], queryFn: () => api<{ items: Customer[] }>('/customers?pageSize=100'), enabled: !initialCustomerId });
  const { data: cust, isLoading } = useQuery({ queryKey: ['customer', customerId], queryFn: () => api<any>(`/customers/${customerId}`), enabled: !!customerId });
  const { data: techs } = useQuery({ queryKey: ['technicians'], queryFn: () => api<Tech[]>('/users/technicians') });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ items: Svc[] }>('/services?active=true&pageSize=100') });

  const location = useMemo(() => cust?.serviceLocations?.find((l: any) => l.isPrimary) ?? cust?.serviceLocations?.[0], [cust]);
  const toggleService = (id: string) => setServiceIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const create = async () => {
    setError('');
    if (!customerId || !location) return setError('Choose a customer with a service location.');
    if (!serviceIds.length) return setError('Choose at least one service.');
    if (frequency === 'custom' && (!Number(customDays) || Number(customDays) < 1)) return setError('Enter custom interval days.');
    setBusy(true);
    try {
      const sub = await api<any>('/subscriptions', {
        method: 'POST',
        body: {
          customerId,
          serviceLocationId: location.id,
          frequency,
          intervalDays: frequency === 'custom' ? Number(customDays) : null,
          preferredTechnicianId: techId,
          preferredTime,
          startDate,
          services: serviceIds.map((serviceId) => ({ serviceId })),
          generateAheadDays: 30,
          generateImmediately: true,
        },
      });
      setCreated(sub);
      void qc.invalidateQueries({ queryKey: ['customerPlans', customerId] });
      void qc.invalidateQueries({ queryKey: ['customer', customerId] });
      void qc.invalidateQueries({ queryKey: ['customerAppts', customerId] });
      Alert.alert('Plan created', 'Upcoming visits were generated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading && customerId) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!initialCustomerId && (
        <>
          <SectionTitle>Customer</SectionTitle>
          {(customers?.items ?? []).map((c) => (
            <TouchableOpacity key={c.id} style={[styles.pickRow, customerId === c.id && styles.pickRowActive]} onPress={() => setCustomerId(c.id)}>
              <Text style={styles.pickName}>{c.company ?? `${c.firstName} ${c.lastName}`}</Text>
              {c.primaryAddress ? <Text style={styles.meta}>{c.primaryAddress}</Text> : null}
            </TouchableOpacity>
          ))}
        </>
      )}

      {cust ? <Text style={styles.customer}>{cust.company ?? `${cust.firstName} ${cust.lastName}`}</Text> : null}

      <SectionTitle>Frequency</SectionTitle>
      <View style={styles.wrapRow}>{FREQUENCIES.map(([key, label]) => (
        <TouchableOpacity key={key} style={[styles.chip, frequency === key && styles.chipActive]} onPress={() => setFrequency(key)}>
          <Text style={[styles.chipText, frequency === key && styles.chipTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}</View>
      {frequency === 'custom' && <TextInput style={styles.input} value={customDays} onChangeText={setCustomDays} keyboardType="number-pad" placeholder="Interval days" />}

      <SectionTitle>Start Date</SectionTitle>
      <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />

      <SectionTitle>Preferred Time</SectionTitle>
      <TextInput style={styles.input} value={preferredTime} onChangeText={setPreferredTime} placeholder="09:00" />

      <SectionTitle>Technician</SectionTitle>
      <View style={styles.wrapRow}>{(techs ?? []).map((t) => (
        <TouchableOpacity key={t.employeeId} style={[styles.chip, techId === t.employeeId && styles.chipActive]} onPress={() => setTechId(techId === t.employeeId ? null : t.employeeId)}>
          <Text style={[styles.chipText, techId === t.employeeId && styles.chipTextActive]}>{t.firstName} {t.lastName}</Text>
        </TouchableOpacity>
      ))}</View>

      <SectionTitle>Services</SectionTitle>
      {(services?.items ?? []).map((s) => (
        <TouchableOpacity key={s.id} style={[styles.serviceRow, serviceIds.includes(s.id) && styles.serviceRowActive]} onPress={() => toggleService(s.id)}>
          <View style={{ flex: 1 }}><Text style={styles.serviceName}>{s.name}</Text><Text style={styles.meta}>{s.durationMinutes} min</Text></View>
          <Text style={styles.price}>{money(s.price)}</Text>
        </TouchableOpacity>
      ))}

      {error ? <ErrorText message={error} /> : null}
      <Button title="Create Recurring Plan" onPress={create} loading={busy} style={{ marginTop: 16 }} />

      {created ? (
        <Card style={{ marginTop: 16 }}>
          <Row><Value style={{ fontWeight: '800' }}>{created.frequency}</Value><StatusBadge status={created.status} /></Row>
          <Text style={styles.meta}>Next service {fmtDate(created.nextServiceDate)}</Text>
          <SectionTitle>Generated Appointments</SectionTitle>
          {(created.generatedAppointments ?? []).slice().reverse().map((a: any) => (
            <TouchableOpacity key={a.id} onPress={() => router.push(`/stop/${a.id}`)}>
              <Text style={styles.generated}>{fmtDate(a.scheduledDate)} · {fmtTime(a.windowStart)} · {a.status}</Text>
            </TouchableOpacity>
          ))}
          <Button title="Back to Customer" variant="outline" onPress={() => router.replace(`/customer/${customerId}?tab=Plan`)} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 70 },
  customer: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '800' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.text, marginBottom: 8 },
  pickRow: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  pickRowActive: { borderColor: colors.primary, borderWidth: 2 },
  pickName: { fontSize: 15, fontWeight: '800', color: colors.text },
  serviceRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  serviceRowActive: { borderColor: colors.primary, borderWidth: 2 },
  serviceName: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  price: { fontSize: 15, fontWeight: '800', color: colors.text },
  generated: { color: colors.primaryDark, fontWeight: '700', paddingVertical: 6 },
});
