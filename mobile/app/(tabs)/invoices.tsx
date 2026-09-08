import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView, TextInput, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api, newIdempotencyKey } from '../../src/lib/api';
import { confirmAction, notify } from '../../src/lib/confirm';
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
  frequencyLabel?: string;
  nextDueDate?: string | null;
  isDue?: boolean;
}

interface ChargeResult {
  charged: boolean;
  invoiceId: string;
  amount: number;
  reason?: string;
}

type RecurringFilter = 'due' | 'week' | 'upcoming' | 'all';
const RECURRING_FILTERS: { key: RecurringFilter; label: string }[] = [
  { key: 'due', label: 'Due' },
  { key: 'week', label: 'This Week' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plusDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function useRecurringCharges() {
  return useQuery({
    queryKey: ['recurring-charges'],
    queryFn: () => api<{ items: RecurringCharge[]; total: number }>('/recurring-charges'),
  });
}

function RecurringView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecurringFilter>('due');
  const [search, setSearch] = useState('');
  const { data, isLoading, refetch, isRefetching } = useRecurringCharges();

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
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onSuccess: (result) => {
      if (result.charged) {
        notify('Payment collected', `Charged ${money(result.amount)} for the recurring service.`);
        router.push(`/invoice/${result.invoiceId}`);
      } else {
        notify('Invoice created', result.reason ?? 'The invoice was created but the card could not be charged.');
        router.push(`/invoice/${result.invoiceId}`);
      }
    },
    onError: (e: any) => notify('Charge failed', e?.message ?? 'Unable to charge recurring service.'),
  });

  const confirmCharge = (item: RecurringCharge) => {
    confirmAction({
      title: 'Charge recurring service',
      message: `Charge ${item.customerName} ${money(item.amount)} for their regular recurring service?`,
      confirmText: 'Charge',
      destructive: true,
      onConfirm: () => {
        setChargingId(item.id);
        chargeMutation.mutate(item.id);
      },
    });
  };

  const all = data?.items ?? [];
  const today = todayIso();
  const weekEnd = plusDaysIso(7);
  const dueItems = all.filter((i) => i.isDue || (i.nextDueDate != null && i.nextDueDate <= today));
  const dueAmount = dueItems.reduce((s, i) => s + i.amount, 0);
  const needle = search.trim().toLowerCase();
  const items = all.filter((i) => {
    if (needle && !i.customerName.toLowerCase().includes(needle)) return false;
    const due = i.nextDueDate ?? '';
    switch (filter) {
      case 'due': return i.isDue || (!!due && due <= today);
      case 'week': return !!due && due <= weekEnd;
      case 'upcoming': return !due || due > today;
      default: return true;
    }
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryPill, dueItems.length ? styles.summaryPillDue : null]}>
          <Text style={[styles.summaryValue, dueItems.length ? styles.summaryValueDue : null]}>{dueItems.length}</Text>
          <Text style={[styles.summaryLabel, dueItems.length ? styles.summaryValueDue : null]}>due · {money(dueAmount)}</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{all.length}</Text>
          <Text style={styles.summaryLabel}>active plans</Text>
        </View>
      </View>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search customer"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
        {RECURRING_FILTERS.map((f) => (
          <TouchableOpacity key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}{f.key === 'due' && dueItems.length ? ` (${dueItems.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              title={filter === 'due' ? 'Nothing due' : 'No recurring plans'}
              subtitle={filter === 'due' ? 'Every customer is up to date. Check Upcoming to see what is next.' : 'Signed agreements create recurring plans automatically.'}
            />
          }
          renderItem={({ item }) => (
            <View style={[styles.card, item.isDue && styles.cardDue]}>
              <TouchableOpacity onPress={() => router.push(`/customer/${item.customerId}`)} activeOpacity={0.7}>
                <View style={styles.rowTop}>
                  <Text style={styles.number}>{item.customerName}</Text>
                  <StatusBadge status={item.isDue ? 'past_due' : 'recurring'} />
                </View>
                <Text style={styles.customer}>{item.description}</Text>
                <View style={styles.rowBottom}>
                  <Text style={[styles.date, item.isDue && styles.dueText]}>
                    {item.frequencyLabel ?? 'Monthly'}
                    {item.nextDueDate ? (item.isDue ? ` · Due ${fmtDate(item.nextDueDate)}` : ` · Next ${fmtDate(item.nextDueDate)}`) : ''}
                  </Text>
                  <Text style={styles.total}>{money(item.amount)}</Text>
                </View>
                <Text style={styles.date}>{item.lastChargedAt ? `Last charged ${fmtDate(item.lastChargedAt)}` : 'Not charged yet'}</Text>
              </TouchableOpacity>
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
          )}
        />
      )}
    </View>
  );
}

function InvoicesView() {
  const router = useRouter();
  const [status, setStatus] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['invoices', status],
    queryFn: () => api<{ items: any[]; total: number }>(`/invoices?pageSize=50${status ? `&status=${status}` : ''}`),
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
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
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />}
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

export default function InvoicesScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<'invoices' | 'recurring'>(params.section === 'recurring' ? 'recurring' : 'invoices');
  useEffect(() => {
    if (params.section === 'recurring' || params.section === 'invoices') setSection(params.section);
  }, [params.section]);
  const recurring = useRecurringCharges();
  const dueCount = (recurring.data?.items ?? []).filter((i) => i.isDue).length;

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentBtn, section === 'invoices' && styles.segmentBtnActive]} onPress={() => setSection('invoices')}>
          <Text style={[styles.segmentText, section === 'invoices' && styles.segmentTextActive]}>Invoices</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, section === 'recurring' && styles.segmentBtnActive]} onPress={() => setSection('recurring')}>
          <Text style={[styles.segmentText, section === 'recurring' && styles.segmentTextActive]}>Recurring Services</Text>
          {dueCount ? (
            <View style={styles.segmentBadge}><Text style={styles.segmentBadgeText}>{dueCount}</Text></View>
          ) : null}
        </TouchableOpacity>
      </View>
      {section === 'invoices' ? <InvoicesView /> : <RecurringView />}
    </View>
  );
}

const styles = StyleSheet.create({
  // Explicit height so the horizontal row is not squeezed on web (labels crop otherwise).
  filters: { flexGrow: 0, flexShrink: 0, height: 40, marginVertical: 10 },
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
  dueText: { color: colors.danger, fontWeight: '800' },
  total: { fontSize: 15, fontWeight: '800', color: colors.text },
  cardDue: { borderWidth: 1.5, borderColor: colors.danger },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: '#E3ECEA', borderRadius: 12, padding: 3 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10 },
  segmentBtnActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  segmentTextActive: { color: colors.text, fontWeight: '800' },
  segmentBadge: { marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segmentBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12 },
  summaryPill: { flex: 1, flexDirection: 'row', alignItems: 'baseline', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginRight: 8, borderWidth: 1, borderColor: colors.border },
  summaryPillDue: { borderColor: colors.danger, backgroundColor: '#FFF3F2' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.text, marginRight: 6 },
  summaryValueDue: { color: colors.danger },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  search: { marginHorizontal: 16, marginTop: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.text },
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
