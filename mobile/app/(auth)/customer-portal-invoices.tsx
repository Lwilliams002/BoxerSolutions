import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalInvoice, Paginated } from '../../src/lib/types';
import { colors, money } from '../../src/lib/theme';

export default function CustomerPortalInvoicesScreen() {
  const query = useQuery({
    queryKey: ['portal-invoices-all'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalInvoice>>('/invoices?page=1&pageSize=50'),
  });

  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((inv) => (
        <Card key={inv.id}>
          <Text style={styles.number}>{inv.invoice_number}</Text>
          <Text style={styles.meta}>Status: {inv.status}</Text>
          <Text style={styles.meta}>Date: {inv.invoice_date} · Due: {inv.due_date}</Text>
          <Text style={styles.total}>Total: {money(inv.total)}</Text>
          <Text style={styles.balance}>Balance Due: {money(inv.balance_due)}</Text>
        </Card>
      ))}
      {items.length === 0 ? <Text style={styles.empty}>No invoices found.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 24 },
  number: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  meta: { color: colors.textMuted, marginBottom: 4 },
  total: { color: colors.text, marginBottom: 4 },
  balance: { color: colors.success, fontWeight: '800' },
  empty: { color: '#fff', textAlign: 'center', marginTop: 30 },
});
