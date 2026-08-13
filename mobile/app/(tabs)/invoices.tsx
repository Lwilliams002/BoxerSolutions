import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, money, fmtDate } from '../../src/lib/theme';
import { Loading, EmptyState, StatusBadge } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

const FILTERS = ['', 'open', 'past_due', 'partially_paid', 'paid', 'draft', 'void'];

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
  chipTextActive: { color: '#fff' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  number: { fontSize: 15, fontWeight: '800', color: colors.text },
  customer: { fontSize: 14, color: colors.text, marginTop: 4 },
  date: { fontSize: 12, color: colors.textMuted },
  total: { fontSize: 15, fontWeight: '800', color: colors.text },
});
