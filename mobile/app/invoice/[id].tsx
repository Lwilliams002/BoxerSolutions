import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking, TextInput } from 'react-native';
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

interface PaymentRow {
  id: string;
  amount: string;
  status: string;
  failureReason?: string | null;
  receiptNumber?: string | null;
  receiptFileId?: string | null;
  processedAt?: string | null;
  createdAt: string;
  brand?: string | null;
  last4?: string | null;
  paymentSource?: string | null;
  parentPaymentId?: string | null;
  remainingRefundableAmount?: string | null;
}

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [busy, setBusy] = useState<string | null>(null);
  const [refundAmountByPayment, setRefundAmountByPayment] = useState<Record<string, string>>({});

  const { data: inv, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api<InvoiceDetail>(`/invoices/${id}`),
  });
  const { data: methods } = useQuery({
    queryKey: ['paymentMethods', inv?.customerId],
    queryFn: () => api<Method[]>(`/payment-methods?customerId=${inv!.customerId}`),
    enabled: !!inv?.customerId,
  });
  const { data: payments } = useQuery({
    queryKey: ['invoicePayments', id],
    queryFn: () => api<{ items: PaymentRow[] }>(`/payments?invoiceId=${id}&pageSize=50`),
    enabled: !!id,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['invoice', id] });
    void qc.invalidateQueries({ queryKey: ['invoicePayments', id] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const requestOwnerCharge = async () => {
    setBusy('request-charge');
    try {
      await api('/payments/request-charge', {
        method: 'POST',
        body: { invoiceId: id, message: 'Please review and charge this invoice.' },
      });
      Alert.alert('Request sent', 'The owner has been notified to charge this invoice.');
    } catch (e) {
      Alert.alert('Unable to send request', (e as Error).message);
    } finally {
      setBusy(null);
    }
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

  const retryDefault = () => {
    const method = methods?.find((m) => m.isDefault) ?? methods?.[0];
    if (!method) {
      Alert.alert('No payment method', 'Add a saved payment method from the customer profile, then retry.');
      return;
    }
    charge(method);
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
      const dl = await api<{ downloadUrl: string }>(`/files/${fileId}/download`);
      await Linking.openURL(dl.downloadUrl);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openReceipt = async (paymentId: string) => {
    setBusy(`receipt-${paymentId}`);
    try {
      const dl = await api<{ downloadUrl: string }>(`/payments/${paymentId}/receipt`);
      await Linking.openURL(dl.downloadUrl);
    } catch (e) {
      Alert.alert('Receipt unavailable', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createNorthInvoiceLink = async () => {
    setBusy('north-link');
    try {
      const { url } = await api<{ url: string }>('/payments/north/invoice-link', {
        method: 'POST',
        body: { invoiceId: id },
      });
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Unable to create payment link', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refund = (payment: PaymentRow) => {
    const amountText = refundAmountByPayment[payment.id] ?? String(Number(payment.remainingRefundableAmount ?? payment.amount).toFixed(2));
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a refund amount greater than zero.');
      return;
    }
    Alert.alert('Confirm refund', `Refund ${money(amount)} from payment ${payment.receiptNumber ?? payment.id}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Refund ${money(amount)}`,
        style: 'destructive',
        onPress: async () => {
          setBusy(`refund-${payment.id}`);
          try {
            await api(`/payments/${payment.id}/refund`, { method: 'POST', body: { amount } });
            refresh();
            Alert.alert('Refund processed', `${money(amount)} was refunded.`);
          } catch (e) {
            Alert.alert('Refund failed', (e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const lastFailed = useMemo(() => (payments?.items ?? []).find((p) => p.status === 'failed'), [payments]);

  if (isLoading || !inv) return <Loading />;

  const unpaid = parseFloat(inv.balanceDue ?? '0') > 0 && !['void', 'draft'].includes(inv.status);
  const canCollect = hasPermission('payments:collect', 'payments:write');
  const canRefund = hasPermission('payments:write') && ['paid', 'partially_paid'].includes(inv.status);
  const canRequestCharge = !canCollect && hasPermission('invoices:read', 'invoices:read_assigned');
  const paymentRows = payments?.items ?? [];

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

      {lastFailed && unpaid ? (
        <Card style={styles.failureBanner}>
          <Text style={styles.failureTitle}>Last payment attempt failed</Text>
          <Text style={styles.failureText}>{lastFailed.failureReason ?? 'Payment was declined.'}</Text>
          {canCollect ? <Button title="Retry Payment" variant="danger" onPress={retryDefault} loading={busy === (methods?.find((m) => m.isDefault)?.id ?? '')} /> : null}
        </Card>
      ) : null}

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
      {canCollect || hasPermission('payments:write') ? (
        <Button title="Create North Payment Link" variant="secondary" onPress={createNorthInvoiceLink} loading={busy === 'north-link'} />
      ) : null}
      {unpaid && canRequestCharge && !canCollect ? (
        <Button title="Request Owner Charge" variant="outline" onPress={requestOwnerCharge} loading={busy === 'request-charge'} />
      ) : null}

      {paymentRows.length > 0 ? (
        <>
          <SectionTitle>Payments & Refunds</SectionTitle>
          {paymentRows.map((p) => {
            const isRefund = Number(p.amount) < 0 || p.paymentSource === 'refund';
            const refundable = !isRefund && p.status === 'succeeded' && Number(p.remainingRefundableAmount ?? 0) > 0;
            const defaultRefundAmount = String(Number(p.remainingRefundableAmount ?? p.amount).toFixed(2));
            const refundText = refundAmountByPayment[p.id] ?? defaultRefundAmount;
            return (
              <Card key={p.id}>
                <Row>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Value style={{ fontWeight: '700', color: isRefund ? colors.warning : colors.text }}>
                      {isRefund ? 'Refund ' : ''}{money(p.amount)}
                    </Value>
                    <Text style={styles.itemMeta}>
                      {fmtDate(p.processedAt ?? p.createdAt)}{p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
                      {p.failureReason ? ` · ${p.failureReason}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={isRefund ? 'refunded' : p.status} />
                </Row>
                {p.receiptFileId ? (
                  <Button title="View Receipt" variant="outline" onPress={() => openReceipt(p.id)} loading={busy === `receipt-${p.id}`} />
                ) : null}
                {canRefund && refundable ? (
                  <View style={styles.refundBox}>
                    <Label>Refund Amount</Label>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={refundText}
                      onChangeText={(text) => setRefundAmountByPayment((prev) => ({ ...prev, [p.id]: text }))}
                    />
                    <Button title="Refund" variant="danger" onPress={() => refund(p)} loading={busy === `refund-${p.id}`} />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

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
                  <Text style={styles.chargeAmount}>Due {money(inv.balanceDue)}</Text>
                </View>
                <Button
                  title="Charge"
                  variant="success"
                  onPress={() => charge(m)}
                  loading={busy === m.id}
                  style={styles.chargeBtn}
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
  failureBanner: { backgroundColor: '#FFF4F2', borderWidth: 1, borderColor: '#FFD0C9' },
  failureTitle: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  failureText: { color: colors.text, marginTop: 4, marginBottom: 8 },
  refundBox: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    marginBottom: 8,
    backgroundColor: colors.bg,
  },
  chargeBtn: {
    marginVertical: 0,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  chargeAmount: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
