import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, newIdempotencyKey } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money, fmtDate, fmtTime } from '../../src/lib/theme';
import { Card, Button, StatusBadge, Loading, Row, Value, Label, EmptyState } from '../../src/components/ui';

const TABS = ['Overview', 'Plan', 'Appointments', 'Invoices', 'Payments', 'Comms', 'Notes', 'Documents', 'Payment Methods', 'History'] as const;
type Tab = (typeof TABS)[number];

function maskedLast4(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return last4 || '••••';
}

export default function CustomerScreen() {
  const { id, tab: tabParam, promptPayment, promptInitialCharge, initialInvoiceId } = useLocalSearchParams<{
    id: string;
    tab?: string;
    promptPayment?: string;
    promptInitialCharge?: string;
    initialInvoiceId?: string;
  }>();
  const router = useRouter();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'Overview');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [customInvoiceDescription, setCustomInvoiceDescription] = useState('Additional service');
  const [customInvoiceAmount, setCustomInvoiceAmount] = useState('');
  const [creatingCustomInvoice, setCreatingCustomInvoice] = useState(false);
  const [chargingRecurring, setChargingRecurring] = useState(false);

  const { data: cust, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<any>(`/customers/${id}`),
  });
  const { data: appts } = useQuery({
    queryKey: ['customerAppts', id],
    queryFn: () => api<{ items: any[] }>(`/appointments?customerId=${id}&pageSize=50`),
    enabled: tab === 'Appointments',
  });
  const { data: invoices } = useQuery({
    queryKey: ['customerInvoices', id],
    queryFn: () => api<{ items: any[] }>(`/invoices?customerId=${id}&pageSize=50`),
    enabled: tab === 'Invoices',
  });
  const { data: recurringCharges } = useQuery({
    queryKey: ['recurring-charges', id],
    queryFn: () => api<{ items: any[] }>(`/recurring-charges?customerId=${id}`),
    enabled: tab === 'Invoices',
  });
  const { data: payments } = useQuery({
    queryKey: ['customerPayments', id],
    queryFn: () => api<{ items: any[] }>(`/payments?customerId=${id}&pageSize=50`),
    enabled: tab === 'Payments',
  });
  const { data: notes } = useQuery({
    queryKey: ['customerNotes', id],
    queryFn: () => api<{ items: any[] }>(`/notes?customerId=${id}&pageSize=50`),
    enabled: tab === 'Notes',
  });
  const { data: comms } = useQuery({
    queryKey: ['customerComms', id],
    queryFn: () => api<{ items: any[] }>(`/communications?customerId=${id}&pageSize=50`),
    enabled: tab === 'Comms',
  });
  const { data: methods } = useQuery({
    queryKey: ['paymentMethods', id],
    queryFn: () => api<any[]>(`/payment-methods?customerId=${id}`),
    enabled: tab === 'Payment Methods' || tab === 'Overview',
  });
  const canCollectPaymentInfo = hasPermission('payments:collect_info', 'payments:collect', 'payments:write');
  const { data: history } = useQuery({
    queryKey: ['customerHistory', id],
    queryFn: () => api<any[]>(`/customers/${id}/service-history`),
    enabled: tab === 'History',
  });
  const { data: docs } = useQuery({
    queryKey: ['customerDocs', id],
    queryFn: () => api<{ items: any[] }>(`/files?customerId=${id}&fileType=document&pageSize=50`),
    enabled: tab === 'Documents',
  });
  const { data: plans } = useQuery({
    queryKey: ['customerPlans', id],
    queryFn: () => api<{ items: any[] }>(`/subscriptions?customerId=${id}&pageSize=20`),
    enabled: tab === 'Plan',
  });

  const openDocument = async (fileId: string, uploadStatus?: string, fileName?: string | null) => {
    if (uploadStatus !== 'uploaded') {
      const isUnsignedAgreement = fileName?.startsWith('service-agreement-unsigned-');
      Alert.alert(
        isUnsignedAgreement ? 'Unsigned document' : 'Document is processing',
        isUnsignedAgreement
          ? 'This agreement has not been signed yet.'
          : 'This signed document is still uploading and will be viewable once processing finishes.',
      );
      return;
    }
    try {
      const { downloadUrl } = await api<{ downloadUrl: string }>(`/files/${fileId}/download`);
      await Linking.openURL(downloadUrl);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const openReceipt = async (paymentId: string) => {
    try {
      const { downloadUrl } = await api<{ downloadUrl: string }>(`/payments/${paymentId}/receipt`);
      await Linking.openURL(downloadUrl);
    } catch (e) {
      Alert.alert('Receipt unavailable', (e as Error).message);
    }
  };

  const toggleAutopay = async () => {
    const defaultMethod = (methods ?? []).find((m) => m.isDefault) ?? (methods ?? [])[0];
    if (!cust.autopayEnabled && !defaultMethod) {
      Alert.alert('Payment method required', 'Add a default payment method before enabling AutoPay.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add Method', onPress: () => { setTab('Payment Methods'); openSaveCard(); } },
      ]);
      return;
    }
    const enable = !cust.autopayEnabled;
    Alert.alert(enable ? 'Enable AutoPay' : 'Disable AutoPay', enable ? 'Use the default saved payment method for due invoices?' : 'Stop automatic payment collection for this customer?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: enable ? 'Enable' : 'Disable',
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/payments/autopay/${id}`, {
              method: 'POST',
              body: { enabled: enable, paymentMethodId: enable ? defaultMethod.id : null },
            });
            void qc.invalidateQueries({ queryKey: ['customer', id] });
            void qc.invalidateQueries({ queryKey: ['paymentMethods', id] });
          } catch (e) {
            Alert.alert('Error', (e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { customerId: id, body: noteText.trim() } });
      setNoteText('');
      void qc.invalidateQueries({ queryKey: ['customerNotes', id] });
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createCustomInvoice = async () => {
    const description = customInvoiceDescription.trim();
    const amount = Number(customInvoiceAmount);
    if (!description) {
      Alert.alert('Description required', 'Add a description for this invoice.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid invoice amount greater than zero.');
      return;
    }

    setCreatingCustomInvoice(true);
    try {
      const invoice = await api<{ id: string }>('/invoices', {
        method: 'POST',
        body: {
          customerId: id,
          taxRate: 0,
          notes: 'Manual custom invoice',
          items: [{ description, quantity: 1, unitPrice: Number(amount.toFixed(2)), taxable: false }],
        },
      });

      setCustomInvoiceDescription('Additional service');
      setCustomInvoiceAmount('');
      void qc.invalidateQueries({ queryKey: ['customerInvoices', id] });
      void qc.invalidateQueries({ queryKey: ['customer', id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      Alert.alert(
        'Invoice created',
        `${money(amount)} was added as a new invoice.${cust?.autopayEnabled ? ' AutoPay will only charge it when the invoice becomes due.' : ''}`,
        [{ text: 'View Invoice', onPress: () => router.push(`/invoice/${invoice.id}`) }],
      );
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setCreatingCustomInvoice(false);
    }
  };

  const chargeRecurring = (rc: any) => {
    Alert.alert(
      'Charge recurring service',
      `Charge ${money(rc.amount)} for the regular recurring service using the card on file?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Charge',
          style: 'destructive',
          onPress: async () => {
            setChargingRecurring(true);
            try {
              const result = await api<{ charged: boolean; invoiceId: string; amount: number; reason?: string }>(
                `/recurring-charges/${rc.id}/charge`,
                { method: 'POST', body: {}, idempotencyKey: newIdempotencyKey() },
              );
              void qc.invalidateQueries({ queryKey: ['recurring-charges', id] });
              void qc.invalidateQueries({ queryKey: ['recurring-charges'] });
              void qc.invalidateQueries({ queryKey: ['customerInvoices', id] });
              void qc.invalidateQueries({ queryKey: ['customerPayments', id] });
              void qc.invalidateQueries({ queryKey: ['customer', id] });
              void qc.invalidateQueries({ queryKey: ['invoices'] });
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
            } catch (e) {
              Alert.alert('Charge failed', (e as Error).message);
            } finally {
              setChargingRecurring(false);
            }
          },
        },
      ],
    );
  };

  const openSaveCard = () => {
    router.push({ pathname: '/customer/save-card', params: { customerId: id } });
  };

  const setDefault = async (methodId: string) => {
    try {
      await api(`/payment-methods/${methodId}/set-default`, { method: 'POST', body: {} });
      void qc.invalidateQueries({ queryKey: ['paymentMethods', id] });
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const removeCard = async (methodId: string) => {
    Alert.alert('Remove card', 'Remove this payment method?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/payment-methods/${methodId}`, { method: 'DELETE' });
            void qc.invalidateQueries({ queryKey: ['paymentMethods', id] });
          } catch (e) {
            Alert.alert('Error', (e as Error).message);
          }
        },
      },
    ]);
  };

  const planAction = (plan: any, action: 'pause' | 'resume' | 'cancel' | 'skip') => {
    const title = action === 'skip' ? 'Skip next visit' : `${action[0].toUpperCase()}${action.slice(1)} plan`;
    const message = action === 'skip' ? 'Cancel the next generated appointment and move the plan forward?' : `${title}?`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: title,
        style: action === 'cancel' ? 'destructive' : 'default',
        onPress: async () => {
          try {
            if (action === 'skip') await api(`/subscriptions/${plan.id}/skip-next`, { method: 'POST', body: {} });
            else await api(`/subscriptions/${plan.id}/status`, { method: 'POST', body: { status: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'cancelled' } });
            void qc.invalidateQueries({ queryKey: ['customerPlans', id] });
            void qc.invalidateQueries({ queryKey: ['customer', id] });
            void qc.invalidateQueries({ queryKey: ['customerAppts', id] });
          } catch (e) {
            Alert.alert('Error', (e as Error).message);
          }
        },
      },
    ]);
  };

  if (isLoading || !cust) return <Loading />;

  const name = cust.company ?? `${cust.firstName} ${cust.lastName}`;
  const allDocs = docs?.items ?? [];
  const isServiceAgreement = (fileName: string | null | undefined) => fileName?.startsWith('service-agreement');
  const isUnsignedAgreementName = (fileName: string | null | undefined) => fileName?.startsWith('service-agreement-unsigned-');
  const isSignedAgreementName = (fileName: string | null | undefined) => fileName?.startsWith('service-agreement-signed-');
  const agreementStatus = (doc: any) => {
    if (!isServiceAgreement(doc.fileName)) return doc.uploadStatus;
    if (isUnsignedAgreementName(doc.fileName)) return 'Unsigned';
    if (isSignedAgreementName(doc.fileName)) return doc.uploadStatus === 'uploaded' ? 'Signed' : 'Pending upload';
    return doc.uploadStatus === 'uploaded' ? 'Signed' : 'Pending upload';
  };
  const agreementDocs = allDocs.filter((d) => isServiceAgreement(d.fileName));
  const activeAgreement = agreementDocs[0] ?? null;
  const canResendAgreementRequest = Boolean(
    activeAgreement &&
    isUnsignedAgreementName(activeAgreement.fileName),
  );
  const visibleDocs = allDocs;
  const addAgreement = () => {
    const primaryLocation =
      (cust.serviceLocations ?? []).find((l: any) => l.isPrimary) ??
      (cust.serviceLocations ?? [])[0];
    if (!primaryLocation?.addressLine1 || !primaryLocation?.city || !primaryLocation?.state || !primaryLocation?.postalCode) {
      Alert.alert('Service location required', 'Add a valid service location before creating a new agreement.');
      return;
    }
    const payload = {
      firstName: cust.firstName,
      lastName: cust.lastName,
      company: cust.company ?? null,
      email: cust.email ?? null,
      phone: cust.phone ?? null,
      customerType: cust.customerType,
      billingAddressLine1: cust.billingAddressLine1 ?? null,
      billingCity: cust.billingCity ?? null,
      billingState: cust.billingState ?? null,
      billingPostalCode: cust.billingPostalCode ?? null,
      serviceLocation: {
        addressLine1: primaryLocation.addressLine1,
        city: primaryLocation.city,
        state: primaryLocation.state,
        postalCode: primaryLocation.postalCode,
      },
    };
    router.push({
      pathname: '/customer/agreement',
      params: { payload: JSON.stringify(payload), customerId: id },
    });
  };
  const resendAgreementRequest = async () => {
    if (!cust.email) {
      Alert.alert('Customer email required', 'This customer needs an email address before sending a signature request.');
      return;
    }
    setBusy(true);
    try {
      await api('/communications/agreement-review-request', {
        method: 'POST',
        body: { customerId: id },
      });
      void qc.invalidateQueries({ queryKey: ['customerComms', id] });
      Alert.alert('Sent', 'Agreement review/signature email was sent again.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headerCard}>
        <Text style={styles.name}>{name}</Text>
        <Row style={{ marginTop: 6 }}>
          <StatusBadge status={cust.status} />
          <Text style={[styles.balance, parseFloat(cust.balance) > 0 && { color: '#FF7A6E' }]}>
            Balance {money(cust.balance)}
          </Text>
        </Row>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'Overview' && (
          <>
            <Card>
              {cust.phone ? (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${cust.phone}`)}>
                  <Label>Phone</Label>
                  <Value style={{ color: colors.info }}>{cust.phone}</Value>
                </TouchableOpacity>
              ) : null}
              {cust.email ? (
                <View style={{ marginTop: 8 }}>
                  <Label>Email</Label>
                  <Value>{cust.email}</Value>
                </View>
              ) : null}
              <View style={{ marginTop: 8 }}>
                <Label>Type</Label>
                <Value>{cust.customerType}</Value>
              </View>
              <View style={{ marginTop: 8 }}>
                <Label>AutoPay</Label>
                <Value>{cust.autopayEnabled ? 'Enabled ⟳' : 'Disabled'}</Value>
              </View>
              {hasPermission('payments:write') ? (
                <Button
                  title={cust.autopayEnabled ? 'Disable AutoPay' : 'Enable AutoPay'}
                  variant={cust.autopayEnabled ? 'outline' : 'success'}
                  onPress={toggleAutopay}
                  loading={busy}
                />
              ) : null}
              {cust.billingAddressLine1 ? (
                <View style={{ marginTop: 8 }}>
                  <Label>Billing Address</Label>
                  <Value>
                    {cust.billingAddressLine1}, {cust.billingCity}, {cust.billingState} {cust.billingPostalCode}
                  </Value>
                </View>
              ) : null}
            </Card>
            {(cust.serviceLocations ?? []).map((l: any) => (
              <Card key={l.id}>
                <Label>{l.isPrimary ? 'Primary Service Location' : l.label ?? 'Service Location'}</Label>
                <Value>
                  {l.addressLine1}, {l.city}, {l.state} {l.postalCode}
                </Value>
                {l.accessNotes ? <Text style={styles.accessNotes}>Access: {l.accessNotes}</Text> : null}
              </Card>
            ))}
            {hasPermission('appointments:write') && (
              <Button title="+ New Appointment" onPress={() => router.push({ pathname: '/appointment/new', params: { customerId: id } })} />
            )}
          </>
        )}


        {tab === 'Plan' && (
          <>
            {hasPermission('appointments:write') && (
              <Button title="+ New Plan" onPress={() => router.push({ pathname: '/subscription/new', params: { customerId: id } })} />
            )}
            {((plans?.items?.length ?? 0) === 0) ? (
              <EmptyState title="No recurring plan" subtitle="Create a plan to automate future service visits." />
            ) : (
              plans!.items.map((plan) => (
                <Card key={plan.id}>
                  <Row>
                    <Value style={{ fontWeight: '800' }}>{String(plan.frequency).replace('_', ' ')}</Value>
                    <StatusBadge status={plan.status} />
                  </Row>
                  <View style={{ marginTop: 8 }}>
                    <Label>Next Service</Label>
                    <Value>{fmtDate(plan.nextServiceDate ?? plan.nextGenerationDate)}</Value>
                  </View>
                  <Text style={styles.metaText}>{(plan.services ?? []).map((s: any) => s.name).join(', ')}</Text>
                  {plan.preferredTechnicianName ? <Text style={styles.metaText}>{plan.preferredTechnicianName} · {fmtTime(plan.preferredTime)}</Text> : null}
                  {hasPermission('appointments:write') && (
                    <View style={styles.planActions}>
                      {plan.status === 'active' ? (
                        <TouchableOpacity onPress={() => planAction(plan, 'pause')}><Text style={styles.link}>Pause</Text></TouchableOpacity>
                      ) : plan.status === 'paused' ? (
                        <TouchableOpacity onPress={() => planAction(plan, 'resume')}><Text style={styles.link}>Resume</Text></TouchableOpacity>
                      ) : null}
                      {plan.status !== 'cancelled' && <TouchableOpacity onPress={() => planAction(plan, 'skip')}><Text style={styles.link}>Skip Next</Text></TouchableOpacity>}
                      {plan.status !== 'cancelled' && <TouchableOpacity onPress={() => planAction(plan, 'cancel')}><Text style={[styles.link, { color: colors.danger }]}>Cancel</Text></TouchableOpacity>}
                    </View>
                  )}
                </Card>
              ))
            )}
          </>
        )}

        {tab === 'Appointments' &&
          ((appts?.items?.length ?? 0) === 0 ? (
            <EmptyState title="No appointments" />
          ) : (
            appts!.items.map((a) => (
              <TouchableOpacity key={a.id} onPress={() => router.push(`/stop/${a.id}`)}>
                <Card>
                  <Row>
                    <Value style={{ fontWeight: '700' }}>
                      {fmtDate(a.scheduledDate)} · {fmtTime(a.windowStart)}
                    </Value>
                    <StatusBadge status={a.status} />
                  </Row>
                  <Text style={styles.metaText}>
                    {(a.services ?? []).map((s: any) => s.name).join(', ')}
                    {a.technicianName ? ` · ${a.technicianName}` : ''}
                  </Text>
                </Card>
              </TouchableOpacity>
            ))
          ))}

        {tab === 'Invoices' && (
          <>
            {(recurringCharges?.items ?? []).map((rc: any) => (
              <Card key={rc.id}>
                <Row>
                  <Value style={{ fontWeight: '700' }}>{rc.description ?? 'Regular recurring service'}</Value>
                  <StatusBadge status="recurring" />
                </Row>
                <Row style={{ marginTop: 4 }}>
                  <Text style={styles.metaText}>
                    {rc.lastChargedAt ? `Last charged ${fmtDate(rc.lastChargedAt)}` : 'Not charged yet'}
                  </Text>
                  <Value style={{ fontWeight: '700' }}>{money(rc.amount)}</Value>
                </Row>
                {hasPermission('invoices:write', 'payments:collect', 'payments:write') && (
                  <Button
                    title={chargingRecurring ? 'Charging…' : `Charge ${money(rc.amount)}`}
                    variant="success"
                    onPress={() => chargeRecurring(rc)}
                    loading={chargingRecurring}
                    disabled={chargingRecurring}
                  />
                )}
              </Card>
            ))}

            {hasPermission('invoices:write', 'invoices:write_assigned') && (
              <Card>
                <Text style={styles.metaText}>Create a manual invoice and charge it to the card on file.</Text>
                <TextInput
                  style={[styles.noteInput, { marginTop: 8 }]}
                  placeholder="Description"
                  placeholderTextColor={colors.textMuted}
                  value={customInvoiceDescription}
                  onChangeText={setCustomInvoiceDescription}
                />
                <TextInput
                  style={styles.noteInput}
                  placeholder="Amount"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={customInvoiceAmount}
                  onChangeText={setCustomInvoiceAmount}
                />
                <Button
                  title="Create Invoice"
                  variant="success"
                  onPress={createCustomInvoice}
                  loading={creatingCustomInvoice}
                  disabled={!customInvoiceAmount.trim()}
                />
              </Card>
            )}

            {((invoices?.items?.length ?? 0) === 0 ? (
              <EmptyState title="No invoices" />
            ) : (
              invoices!.items.map((inv) => (
                <TouchableOpacity key={inv.id} onPress={() => router.push(`/invoice/${inv.id}`)}>
                  <Card>
                    <Row>
                      <Value style={{ fontWeight: '700' }}>{inv.invoiceNumber}</Value>
                      <StatusBadge status={inv.status} />
                    </Row>
                    <Row style={{ marginTop: 4 }}>
                      <Text style={styles.metaText}>{fmtDate(inv.invoiceDate)}</Text>
                      <Value style={{ fontWeight: '700' }}>{money(inv.total)}</Value>
                    </Row>
                  </Card>
                </TouchableOpacity>
              ))
            ))}
          </>
        )}

        {tab === 'Payments' &&
          ((payments?.items?.length ?? 0) === 0 ? (
            <EmptyState title="No payments" />
          ) : (
            payments!.items.map((p) => (
              <Card key={p.id}>
                <Row>
                  <Value style={{ fontWeight: '700' }}>{money(p.amount)}</Value>
                  <StatusBadge status={p.status} />
                </Row>
                <Text style={styles.metaText}>
                  {fmtDate(p.processedAt ?? p.createdAt)}
                  {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
                  {p.failureReason ? ` · ${p.failureReason}` : ''}
                </Text>
                {p.receiptFileId ? (
                  <TouchableOpacity onPress={() => openReceipt(p.id)} style={{ marginTop: 8 }}>
                    <Text style={styles.link}>View Receipt</Text>
                  </TouchableOpacity>
                ) : null}
              </Card>
            ))
          ))}

        {tab === 'Notes' && (
          <>
            <Card>
              <TextInput
                style={styles.noteInput}
                placeholder="Add a note…"
                placeholderTextColor={colors.textMuted}
                multiline
                value={noteText}
                onChangeText={setNoteText}
              />
              <Button title="Save Note" variant="outline" onPress={addNote} loading={busy} disabled={!noteText.trim()} />
            </Card>
            {(notes?.items ?? []).map((n) => (
              <Card key={n.id}>
                <Value>{n.body}</Value>
                <Text style={styles.metaText}>
                  {n.authorName} · {fmtDate(n.createdAt)}
                </Text>
              </Card>
            ))}
          </>
        )}

        {tab === 'Comms' &&
          ((comms?.items?.length ?? 0) === 0 ? (
            <EmptyState title="No communications" />
          ) : (
            comms!.items.map((cm) => (
              <Card key={cm.id}>
                <Row>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={styles.commTitle} numberOfLines={1}>
                      {cm.channel === 'sms' ? '💬' : cm.channel === 'email' ? '✉️' : '🔔'} {cm.subject ?? cm.templateKey}
                    </Text>
                    <Text style={styles.metaText} numberOfLines={2}>{cm.body}</Text>
                    <Text style={styles.metaText}>
                      {cm.templateKey.replace(/_/g, ' ')} · {fmtDate(cm.sentAt ?? cm.createdAt)}
                    </Text>
                  </View>
                  <StatusBadge status={cm.status} />
                </Row>
              </Card>
            ))
          ))}

        {tab === 'Payment Methods' && (
          <>
            {hasPermission('payments:write') ? (
              <Card>
                <Row>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Value style={{ fontWeight: '800' }}>AutoPay</Value>
                    <Text style={styles.metaText}>
                      {cust.autopayEnabled ? 'Enabled for due invoices' : 'Disabled'}
                    </Text>
                  </View>
                  <Button
                    title={cust.autopayEnabled ? 'Disable' : 'Enable'}
                    variant={cust.autopayEnabled ? 'outline' : 'success'}
                    onPress={toggleAutopay}
                    loading={busy}
                    style={{ paddingVertical: 10 }}
                  />
                </Row>
              </Card>
            ) : null}
            {promptPayment === '1' && (methods ?? []).length === 0 && (
              <View style={styles.setupBanner}>
                <Text style={styles.setupBannerTitle}>Set up billing</Text>
                <Text style={styles.setupBannerText}>
                  {promptInitialCharge === '1' && initialInvoiceId
                    ? 'Add a card or bank account now to save it on file and immediately collect the initial service charge.'
                    : 'This customer has no payment method on file. Add a card or bank account below to enable payment collection and AutoPay.'}
                </Text>
              </View>
            )}
            {(methods ?? []).map((m) => (
              <Card key={m.id}>
                <Row>
                  <View>
                    <Value style={{ fontWeight: '700' }}>
                      {m.brand === 'Bank Account' ? 'Bank Account' : m.brand} •••• {maskedLast4(m.last4)}
                    </Value>
                    <Text style={styles.metaText}>
                      {m.brand === 'Bank Account'
                        ? 'ACH'
                        : `Expires ${String(m.expirationMonth).padStart(2, '0')}/${String(m.expirationYear).slice(-2)}`}
                      {m.isDefault ? '  ·  DEFAULT' : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    {!m.isDefault && (
                      <TouchableOpacity onPress={() => setDefault(m.id)} style={{ marginRight: 14 }}>
                        <Text style={styles.link}>Set Default</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => removeCard(m.id)}>
                      <Text style={[styles.link, { color: colors.danger }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </Row>
              </Card>
            ))}
            {canCollectPaymentInfo && (
              <Button
                title="Save Card via Secure Checkout"
                variant="success"
                onPress={openSaveCard}
              />
            )}
            {(methods ?? []).length === 0 && !(promptPayment === '1') && (
              <EmptyState title="No payment methods" subtitle="Add a card to enable payment collection and AutoPay." />
            )}
          </>
        )}

        {tab === 'History' &&
          ((history?.length ?? 0) === 0 ? (
            <EmptyState title="No service history" />
          ) : (
            history!.map((h) => (
              <Card key={h.id}>
                <Row>
                  <Value style={{ fontWeight: '700' }}>{fmtDate(h.scheduledDate)}</Value>
                  <StatusBadge status={h.status} />
                </Row>
                <Text style={styles.metaText}>
                  {(h.services ?? []).map((s: any) => s.name).join(', ')}
                  {h.technicianName ? ` · ${h.technicianName}` : ''}
                </Text>
                {h.invoiceNumber ? (
                  <Text style={styles.metaText}>
                    {h.invoiceNumber} · {h.invoiceStatus}
                  </Text>
                ) : null}
              </Card>
            ))
          ))}
        {tab === 'Documents' &&
          (
            <>
              {canResendAgreementRequest && hasPermission('customers:write') ? (
                <Card>
                  <Text style={styles.metaText}>Customer has not signed yet.</Text>
                  <Button title="Resend Signature Email" variant="outline" onPress={resendAgreementRequest} loading={busy} />
                </Card>
              ) : null}
              {hasPermission('customers:write') ? (
                <Card>
                  <Text style={styles.metaText}>Need to change services? Create a new agreement version.</Text>
                  <Button title="+ Add Agreement" onPress={addAgreement} />
                </Card>
              ) : null}
              {visibleDocs.length === 0 ? (
                <EmptyState title="No documents" subtitle="Signed agreements and uploads appear here." />
              ) : (
                <>
              {visibleDocs.map((d) => (
                <TouchableOpacity key={d.id} onPress={() => openDocument(d.id, d.uploadStatus, d.fileName)}>
                  <Card>
                    <Row>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 20, marginRight: 10 }}>📄</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 15 }} numberOfLines={1}>
                            {d.fileName?.startsWith('service-agreement') ? 'Service Agreement' : d.fileName}
                          </Text>
                          <Text style={styles.metaText}>{fmtDate(d.createdAt)}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: agreementStatus(d) === 'Signed' ? '#2A8F57' : '#B26B00', fontWeight: '800' }}>
                          {isServiceAgreement(d.fileName) ? agreementStatus(d) : d.uploadStatus}
                        </Text>
                        <Text style={{ color: colors.primaryDark, fontWeight: '800', marginTop: 4 }}>
                          {d.uploadStatus === 'uploaded' ? 'View' : 'Pending'}
                        </Text>
                      </View>
                    </Row>
                  </Card>
                </TouchableOpacity>
              ))}
                </>
              )}
            </>
          )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  setupBanner: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  setupBannerTitle: { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  setupBannerText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  headerCard: { backgroundColor: '#0D0D0D', padding: 18, paddingBottom: 16 },
  name: { fontSize: 21, fontWeight: '900', color: '#FFFFFF' },
  balance: { fontSize: 15, fontWeight: '800', color: '#2DC4A2' },
  tabs: { flexGrow: 0, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 9,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderColor: 'transparent',
  },
  tabActive: { borderColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.primaryDark, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  metaText: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  accessNotes: { fontSize: 13, color: colors.warning, marginTop: 4, fontStyle: 'italic' },
  noteInput: { minHeight: 60, fontSize: 15, color: colors.text, textAlignVertical: 'top', marginBottom: 8 },
  link: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  commTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  planActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
});
