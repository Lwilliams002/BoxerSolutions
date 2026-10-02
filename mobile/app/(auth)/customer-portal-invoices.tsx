import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalInvoice, Paginated } from '../../src/lib/types';
import { colors, money } from '../../src/lib/theme';
import { notify } from '../../src/lib/confirm';

const STATUS_LABEL: Record<string, string> = { open: 'Open', sent: 'Open', past_due: 'Past due', partially_paid: 'Partially paid', paid: 'Paid', void: 'Void', draft: 'Draft' };

export default function CustomerPortalInvoicesScreen() {
  const qc = useQueryClient();
  const [payingId, setPayingId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['portal-invoices-all'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalInvoice>>('/invoices?page=1&pageSize=50'),
  });

  // The payment happens on a secure page outside the app; refresh balances when the customer comes back.
  useEffect(() => {
    const refresh = () => {
      void query.refetch();
      void qc.invalidateQueries({ queryKey: ['portal-me'] });
      void qc.invalidateQueries({ queryKey: ['portal-invoices'] });
    };
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    const onFocus = () => refresh();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    return () => {
      sub.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async (inv: CustomerPortalInvoice) => {
    setPayingId(inv.id);
    try {
      const { url } = await customerPortalApi<{ url: string }>(`/invoices/${inv.id}/pay-link`, { method: 'POST', body: {} });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // New tab so the portal stays open behind the secure payment page.
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) window.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch (e) {
      notify('Could not open the payment page', (e as Error).message);
    } finally {
      setPayingId(null);
    }
  };

  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
    >
      {items.map((inv) => {
        const balance = Number(inv.balance_due ?? 0);
        const payable = balance > 0.005 && !['void', 'draft'].includes(inv.status);
        return (
          <Card key={inv.id}>
            <View style={styles.row}>
              <Text style={styles.number}>{inv.invoice_number}</Text>
              <Text style={[styles.status, inv.status === 'past_due' && styles.statusLate, inv.status === 'paid' && styles.statusPaid]}>{STATUS_LABEL[inv.status] ?? inv.status}</Text>
            </View>
            <Text style={styles.meta}>Date: {String(inv.invoice_date).slice(0, 10)} · Due: {String(inv.due_date).slice(0, 10)}</Text>
            <Text style={styles.total}>Total: {money(inv.total)}</Text>
            <Text style={[styles.balance, payable && { color: inv.status === 'past_due' ? colors.danger : colors.text }]}>Balance Due: {money(inv.balance_due)}</Text>
            {payable ? (
              <>
                <Button title={`Pay ${money(balance)} Now`} variant="success" onPress={() => void pay(inv)} loading={payingId === inv.id} />
                <Text style={styles.hint}>Opens a secure payment page. The card or bank account you use is saved on file for future service charges.</Text>
              </>
            ) : null}
          </Card>
        );
      })}
      {items.length === 0 ? <Text style={styles.empty}>No invoices found.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  number: { color: colors.text, fontWeight: '800', fontSize: 16 },
  status: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  statusLate: { color: colors.danger },
  statusPaid: { color: colors.success },
  meta: { color: colors.textMuted, marginBottom: 4 },
  total: { color: colors.text, marginBottom: 4 },
  balance: { color: colors.success, fontWeight: '800', marginBottom: 6 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  empty: { color: '#fff', textAlign: 'center', marginTop: 30 },
});
