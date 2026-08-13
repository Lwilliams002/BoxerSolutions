import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { api, newIdempotencyKey } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money, fmtDate } from '../../src/lib/theme';
import { Card, Button, StatusBadge, Loading, SectionTitle, Row, Value, Label } from '../../src/components/ui';

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  status: string;
  customerId: string;
  customerName?: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  amountPaid: string;
  balanceDue: string | null;
  pdfFileId: string | null;
  items: { id: string; description: string; quantity: string | number; unitPrice: string; lineTotal: string }[];
}

interface Method {
  id: string;
  brand: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  isDefault: boolean;
}

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: inv, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api<InvoiceDetail>(`/invoices/${id}`),
  });
  const { data: methods } = useQuery({
    queryKey: ['paymentMethods', inv?.customerId],
    queryFn: () => api<Method[]>(`/payment-methods?customerId=${inv!.customerId}`),
    enabled: !!inv?.customerId,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['invoice', id] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const charge = async (method: Method) => {
    Alert.alert('Collect Payment', `Charge ${money(inv!.balanceDue)} to ${method.brand} ****${method.last4}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Charge ${money(inv!.balanceDue)}`,
        onPress: async () => {
          setBusy(method.id);
          try {
            const result = await api<{ receipt: { receiptNumber: string; transactionId: string } }>('/payments/charge', {
              method: 'POST',
              body: { invoiceId: id, paymentMethodId: method.id },
              idempotencyKey: newIdempotencyKey(),
            });
            refresh();
            Alert.alert('Payment collected ✓', `Receipt ${result.receipt.receiptNumber}`);
          } catch (e) {
            Alert.alert('Payment failed', `${(e as Error).message}\n\nThe invoice remains unpaid. You can retry.`);
            refresh();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const openPdf = async () => {
    setBusy('pdf');
    try {
      let fileId = inv!.pdfFileId;
      if (!fileId) {
        const gen = await api<{ fileId: string }>(`/invoices/${id}/generate-pdf`, { method: 'POST', body: {} });
        fileId = gen.fileId;
        refresh();
      }
      const dl = await api<{ url: string }>(`/files/${fileId}/download`);
      await Linking.openURL(dl.url);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !inv) return <Loading />;

  const unpaid = parseFloat(inv.balanceDue ?? '0') > 0 && !['void', 'draft'].includes(inv.status);
  const canCollect = hasPermission('payments:collect', 'payments:write');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Row>
          <Text style={styles.number}>{inv.invoiceNumber}</Text>
          <StatusBadge status={inv.status} />
        </Row>
        {inv.customerName ? <Text style={styles.customer}>{inv.customerName}</Text> : null}
        <Row style={{ marginTop: 8 }}>
          <View>
            <Label>Invoice Date</Label>
            <Value>{fmtDate(inv.invoiceDate)}</Value>
          </View>
          <View>
            <Label>Due Date</Label>
            <Value>{fmtDate(inv.dueDate)}</Value>
          </View>
        </Row>
      </Card>

      <SectionTitle>Line Items</SectionTitle>
      <Card>
        {inv.items.map((it) => (
          <Row key={it.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Value>{it.description}</Value>
              <Text style={styles.itemMeta}>
                {Number(it.quantity)} × {money(it.unitPrice)}
              </Text>
            </View>
            <Value style={{ fontWeight: '700' }}>{money(it.lineTotal)}</Value>
          </Row>
        ))}
        <View style={styles.divider} />
        <Row style={styles.totalRow}><Value>Subtotal</Value><Value>{money(inv.subtotal)}</Value></Row>
        {parseFloat(inv.discountAmount) > 0 && (
          <Row style={styles.totalRow}><Value>Discount</Value><Value>-{money(inv.discountAmount)}</Value></Row>
        )}
        <Row style={styles.totalRow}><Value>Tax</Value><Value>{money(inv.taxAmount)}</Value></Row>
        <Row style={styles.totalRow}>
          <Value style={styles.grand}>Total</Value>
          <Value style={styles.grand}>{money(inv.total)}</Value>
        </Row>
        {parseFloat(inv.amountPaid) > 0 && (
          <>
            <Row style={styles.totalRow}><Value>Paid</Value><Value style={{ color: colors.success }}>{money(inv.amountPaid)}</Value></Row>
            <Row style={styles.totalRow}>
              <Value style={{ fontWeight: '800' }}>Balance Due</Value>
              <Value style={{ fontWeight: '800', color: unpaid ? colors.danger : colors.success }}>{money(inv.balanceDue)}</Value>
            </Row>
          </>
        )}
      </Card>

      <Button title={inv.pdfFileId ? 'View PDF' : 'Generate PDF'} variant="outline" onPress={openPdf} loading={busy === 'pdf'} />

      {unpaid && canCollect ? (
        <>
          <SectionTitle>Collect Payment</SectionTitle>
          {(methods ?? []).map((m) => (
            <Card key={m.id}>
              <Row>
                <View>
                  <Value style={{ fontWeight: '700' }}>
                    {m.brand} **** {m.last4} {m.isDefault ? ' · DEFAULT' : ''}
                  </Value>
                  <Text style={styles.itemMeta}>
                    Expires {String(m.expirationMonth).padStart(2, '0')}/{String(m.expirationYear).slice(-2)}
                  </Text>
                </View>
                <Button
                  title={`Charge ${money(inv.balanceDue)}`}
                  variant="success"
                  onPress={() => charge(m)}
                  loading={busy === m.id}
                  style={{ paddingVertical: 10 }}
                />
              </Row>
            </Card>
          ))}
          {!methods?.length && (
            <Card>
              <Value>No saved payment methods. Add one from the customer profile.</Value>
            </Card>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  number: { fontSize: 20, fontWeight: '800', color: colors.text },
  customer: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  itemRow: { paddingVertical: 6, alignItems: 'flex-start' },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 8 },
  totalRow: { paddingVertical: 3 },
  grand: { fontSize: 17, fontWeight: '800' },
});
