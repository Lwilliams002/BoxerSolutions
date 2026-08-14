import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money, fmtDate, fmtTime } from '../../src/lib/theme';
import { Card, Button, StatusBadge, Loading, Row, Value, Label, EmptyState } from '../../src/components/ui';
import { AddPaymentMethodModal } from '../../src/components/AddPaymentMethodModal';

const TABS = ['Overview', 'Appointments', 'Invoices', 'Payments', 'Notes', 'Documents', 'Payment Methods', 'History'] as const;
type Tab = (typeof TABS)[number];

export default function CustomerScreen() {
  const { id, tab: tabParam, promptPayment } = useLocalSearchParams<{ id: string; tab?: string; promptPayment?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'Overview');
  const [noteText, setNoteText] = useState('');
  const [showAddCard, setShowAddCard] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const { data: methods } = useQuery({
    queryKey: ['paymentMethods', id],
    queryFn: () => api<any[]>(`/payment-methods?customerId=${id}`),
    enabled: tab === 'Payment Methods' || tab === 'Overview',
  });
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

  const openDocument = async (fileId: string) => {
    try {
      const { downloadUrl } = await api<{ downloadUrl: string }>(`/files/${fileId}/download`);
      await Linking.openURL(downloadUrl);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
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

  const addCard = async (token: string) => {
    setBusy(true);
    try {
      await api('/payment-methods', { method: 'POST', body: { customerId: id, token, setDefault: true } });
      setShowAddCard(false);
      void qc.invalidateQueries({ queryKey: ['paymentMethods', id] });
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
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

  if (isLoading || !cust) return <Loading />;

  const name = cust.company ?? `${cust.firstName} ${cust.lastName}`;

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

        {tab === 'Invoices' &&
          ((invoices?.items?.length ?? 0) === 0 ? (
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

        {tab === 'Payment Methods' && (
          <>
            {promptPayment === '1' && (methods ?? []).length === 0 && (
              <View style={styles.setupBanner}>
                <Text style={styles.setupBannerTitle}>Set up billing</Text>
                <Text style={styles.setupBannerText}>
                  This customer has no payment method on file. Add a card below to enable payment collection and AutoPay.
                </Text>
              </View>
            )}
            {(methods ?? []).map((m) => (
              <Card key={m.id}>
                <Row>
                  <View>
                    <Value style={{ fontWeight: '700' }}>
                      {m.brand} **** {m.last4}
                    </Value>
                    <Text style={styles.metaText}>
                      Expires {String(m.expirationMonth).padStart(2, '0')}/{String(m.expirationYear).slice(-2)}
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
            {hasPermission('payments:write', 'payments:collect') && (
              <Button title="+ Add Payment Method" onPress={() => setShowAddCard(true)} />
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
          ((docs?.items?.length ?? 0) === 0 ? (
            <EmptyState title="No documents" subtitle="Signed agreements and uploads appear here." />
          ) : (
            docs!.items.map((d) => (
              <TouchableOpacity key={d.id} onPress={() => openDocument(d.id)}>
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
                    <Text style={{ color: colors.primaryDark, fontWeight: '800' }}>View</Text>
                  </Row>
                </Card>
              </TouchableOpacity>
            ))
          ))}
      </ScrollView>
      <AddPaymentMethodModal
        visible={showAddCard}
        saving={busy}
        onClose={() => setShowAddCard(false)}
        onSubmit={addCard}
      />
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
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 3, borderColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.primaryDark, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  metaText: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  accessNotes: { fontSize: 13, color: colors.warning, marginTop: 4, fontStyle: 'italic' },
  noteInput: { minHeight: 60, fontSize: 15, color: colors.text, textAlignVertical: 'top', marginBottom: 8 },
  link: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
});
