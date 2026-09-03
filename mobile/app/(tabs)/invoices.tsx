import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api, newIdempotencyKey } from '../../src/lib/api';
import { colors, money, fmtDate } from '../../src/lib/theme';
import { Loading, EmptyState, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

const FILTERS = ['', 'open', 'past_due', 'partially_paid', 'paid', 'draft', 'void'];

interface RecurringCharge {
  id: string;
  customerId: string;
  customerName: string;
  description: string;
  amount: number;
  lastChargedAt: string | null;
}

interface ChargeResult {
  charged: boolean;
  invoiceId: string;
  amount: number;
  reason?: string;
}

function RecurringSection() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [chargingId, setChargingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['recurring-charges'],
    queryFn: () => api<{ items: RecurringCharge[]; total: number }>('/recurring-charges'),
  });

  const chargeMutation = useMutation({
    mutationFn: (id: string) =>
      api<ChargeResult>(`/recurring-charges/${id}/charge`, {
        method: 'POST',
        body: {},
        idempotencyKey: newIdempotencyKey(),
      }),
    onSettled: () => {
      setChargingId(null);
      queryClient.invalidateQueries({ queryKey: ['recurring-charges'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onSuccess: (result) => {
      if (result.charged) {
        Alert.alert('Payment collected', `Charged ${money(result.amount)} for the recurring service.`, [
          { text: 'View Invoice', onPress: () => router.push(`/invoice/${result.invoiceId}`) },
          { text: 'OK' },
        ]);
      } else {
        Alert.alert(
          'Invoice created',
          result.reason ?? 'The invoice was created but the card could not be charged.',
          [
            { text: 'Open Invoice', onPress: () => router.push(`/invoice/${result.invoiceId}`) },
            { text: 'Later' },
          ],
        );
      }
    },
    onError: (e: any) => Alert.alert('Charge failed', e?.message ?? 'Unable to charge recurring service.'),
  });

  const confirmCharge = (item: RecurringCharge) => {
    Alert.alert(
      'Charge recurring service',
      `Charge ${item.customerName} ${money(item.amount)} for their regular recurring service?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Charge',
          style: 'destructive',
          onPress: () => {
            setChargingId(item.id);
            chargeMutation.mutate(item.id);
          },
        },
      ],
    );
  };

  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <View style={styles.recurringSection}>
      <Text style={styles.sectionTitle}>Recurring</Text>
      {items.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.number}>{item.customerName}</Text>
            <StatusBadge status="recurring" />
          </View>
          <Text style={styles.customer}>{item.description}</Text>
          <View style={styles.rowBottom}>
            <Text style={styles.date}>
              {item.lastChargedAt ? `Last charged ${fmtDate(item.lastChargedAt)}` : 'Not charged yet'}
            </Text>
            <Text style={styles.total}>{money(item.amount)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.chargeButton, chargingId === item.id && styles.chargeButtonDisabled]}
            disabled={chargingId === item.id}
            onPress={() => confirmCharge(item)}
          >
            <Text style={styles.chargeButtonText}>
              {chargingId === item.id ? 'Charging…' : `Charge ${money(item.amount)}`}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

export default function InvoicesScreen() {
  const router = useRouter();
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', status],
    queryFn: () => api<{ items: any[]; total: number }>(`/invoices?pageSize=50${status ? `&status=${status}` : ''}`),
  });

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f || 'all'} style={[styles.chip, status === f && styles.chipActive]} onPress={() => setStatus(f)}>
            <Text style={[styles.chipText, status === f && styles.chipTextActive]}>
              {f ? f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
          ListHeaderComponent={status === '' ? <RecurringSection /> : null}
          ListEmptyComponent={<EmptyState title="No invoices" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/invoice/${item.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.number}>{item.invoiceNumber}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.customer}>{item.customerName}</Text>
              <View style={styles.rowBottom}>
                <Text style={styles.date}>{fmtDate(item.invoiceDate)} · due {fmtDate(item.dueDate)}</Text>
                <Text style={styles.total}>{money(item.total)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexGrow: 0, marginVertical: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '800' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  number: { fontSize: 15, fontWeight: '800', color: colors.text },
  customer: { fontSize: 14, color: colors.text, marginTop: 4 },
  date: { fontSize: 12, color: colors.textMuted },
  total: { fontSize: 15, fontWeight: '800', color: colors.text },
  recurringSection: { marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  chargeButton: {
    marginTop: 10,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  chargeButtonDisabled: { opacity: 0.5 },
  chargeButtonText: { fontSize: 14, fontWeight: '800', color: '#0D0D0D' },
});
