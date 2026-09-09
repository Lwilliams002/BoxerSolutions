import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, TextInput, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, newIdempotencyKey } from '../../src/lib/api';
import { mutateOrQueue, useSync } from '../../src/lib/offline';
import { compressPhoto, persistLocally, uploadPendingPhoto, PendingPhoto } from '../../src/lib/photos';
import { colors, fmtTime, money, statusLabel } from '../../src/lib/theme';
import { confirmAction, notify } from '../../src/lib/confirm';
import { Card, Button, StatusBadge, Loading, SectionTitle, Row, Value } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { openNavigation } from '../route/[id]';

interface ApptDetail {
  id: string;
  status: string;
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  customerCompany: string | null;
  customerPhone: string | null;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  accessNotes: string | null;
  windowStart: string;
  windowEnd: string;
  scheduledDate: string;
  notes: string | null;
  invoiceId: string | null;
  services: { name: string; unitPrice: number; quantity: number }[];
  recurringChargeId?: string | null;
  recurringFrequency?: string | null;
  recurringAmount?: string | number | null;
  products?: { id: string; productId: string; name: string; quantity: string | number; unit: string; applicationMethod: string | null; targetPests: string | null }[] | null;
}

interface CatalogProduct { id: string; name: string; unit: string; defaultQuantity: string | number }
interface UsedProduct { productId: string; name: string; quantity: string; unit: string; applicationMethod: string }

interface NoteRow { id: string; body: string; createdAt: string; authorName: string }

export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [used, setUsed] = useState<UsedProduct[] | null>(null);
  const catalog = useQuery({ queryKey: ['products'], queryFn: () => api<{ items: CatalogProduct[]; applicationMethods: string[] }>('/products') });
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);

  const { data: appt, isLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api<ApptDetail>(`/appointments/${id}`),
  });
  const { data: notes } = useQuery({
    queryKey: ['notes', id],
    queryFn: () => api<{ items: NoteRow[] }>(`/notes?appointmentId=${id}`),
  });
  const { data: photos } = useQuery({
    queryKey: ['photos', id],
    queryFn: () => api<{ items: { id: string; fileName: string }[] }>(`/files?appointmentId=${id}&fileType=service_photo`),
  });
  const { data: signatures } = useQuery({
    queryKey: ['signatures', id],
    queryFn: () => api<{ id: string }[]>(`/files/signatures/by-appointment/${id}`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['appointment', id] });
    void qc.invalidateQueries({ queryKey: ['route'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const setStatus = async (status: string) => {
    setBusy(status);
    try {
      const { queued } = await mutateOrQueue(`/appointments/${id}/status`, {
        method: 'POST',
        body: { status },
      });
      if (queued) {
        // Optimistically reflect the queued transition so the workflow continues offline.
        qc.setQueryData(['appointment', id], (prev: ApptDetail | undefined) =>
          prev ? { ...prev, status } : prev,
        );
        if (status === 'en_route') {
          await useSync.getState().enqueueApi(`/appointments/${id}/notify-on-my-way`, { method: 'POST', body: {} });
          notify('Saved offline', 'On My Way notification will sync when you are back online.');
        }
      } else {
        if (status === 'en_route') {
          try {
            await api(`/appointments/${id}/notify-on-my-way`, { method: 'POST', body: {} });
            notify('Notification sent', 'Customer was notified that you are on the way.');
          } catch (e) {
            notify('Status updated', `On My Way status was saved, but notification failed: ${(e as Error).message}`);
          }
        }
        refresh();
      }
    } catch (e) {
      notify('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setBusy('note');
    try {
      const { queued } = await mutateOrQueue('/notes', {
        method: 'POST',
        body: { appointmentId: id, body: noteText.trim() },
      });
      setNoteText('');
      if (queued) notify('Saved offline', 'Note will sync when you are back online.');
      else void qc.invalidateQueries({ queryKey: ['notes', id] });
    } catch (e) {
      notify('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const takePhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notify('Permission required', 'Camera/library access is needed to attach photos.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (result.canceled || !result.assets?.[0]) return;

    setBusy('photo');
    try {
      const compressed = await compressPhoto(result.assets[0].uri);
      const fileName = `service-${Date.now()}.jpg`;
      // Keep a local copy until the server confirms the upload.
      const localUri = await persistLocally(compressed, fileName);
      setLocalPhotos((p) => [...p, localUri]);
      const pending: PendingPhoto = {
        localUri,
        fileType: 'service_photo',
        fileName,
        mimeType: 'image/jpeg',
        appointmentId: id,
        customerId: appt?.customerId,
      };
      try {
        await uploadPendingPhoto(pending);
        setLocalPhotos((p) => p.filter((u) => u !== localUri));
        void qc.invalidateQueries({ queryKey: ['photos', id] });
      } catch {
        await useSync.getState().enqueuePhoto(pending);
        notify('Saved offline', 'Photo will upload when you are back online.');
      }
    } catch (e) {
      notify('Error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    const recurring = !!appt?.recurringChargeId;
    confirmAction({
      title: 'Complete Service',
      message: recurring
        ? `Complete this recurring visit? An invoice for ${money(appt?.recurringAmount ?? 0)} will be created for the customer.`
        : 'Complete this appointment and generate the invoice?',
      confirmText: 'Complete',
      onConfirm: async () => {
          setBusy('complete');
          try {
            const { queued, data } = await mutateOrQueue<{ invoice?: { id: string }; recurring?: { invoiceId: string | null; amount: number; charged: boolean; reason: string | null; nextDueDate: string } }>(
              `/appointments/${id}/complete`,
              {
                method: 'POST',
                body: { generateInvoice: true },
                idempotencyKey: newIdempotencyKey(),
              },
            );
            refresh();
            if (queued) {
              notify('Saved offline', 'Completion will sync when you are back online.');
            } else if (data?.invoice?.id) {
              if (data?.recurring) {
                notify(
                  data.recurring.charged ? 'Visit completed and charged' : 'Visit completed',
                  data.recurring.charged
                    ? `${money(data.recurring.amount)} was charged to the card on file. Next visit due ${data.recurring.nextDueDate}.`
                    : `Invoice for ${money(data.recurring.amount)} created${data.recurring.reason ? ` (${data.recurring.reason})` : ''}. Next visit due ${data.recurring.nextDueDate}.`,
                );
              }
              router.push(`/invoice/${data.invoice.id}`);
            }
          } catch (e) {
            notify('Error', (e as Error).message);
          } finally {
            setBusy(null);
          }
      },
    });
  };

  const usedList: UsedProduct[] = used ?? (appt?.products ?? []).map((p) => ({ productId: p.productId, name: p.name, quantity: String(Number(p.quantity)), unit: p.unit, applicationMethod: p.applicationMethod ?? '' }));
  const toggleProduct = (c: CatalogProduct) => {
    const exists = usedList.some((u) => u.productId === c.id);
    setUsed(exists ? usedList.filter((u) => u.productId !== c.id) : [...usedList, { productId: c.id, name: c.name, quantity: String(Number(c.defaultQuantity) || 1), unit: c.unit, applicationMethod: '' }]);
  };
  const updateUsed = (productId: string, patch: Partial<UsedProduct>) => setUsed(usedList.map((u) => (u.productId === productId ? { ...u, ...patch } : u)));
  const saveProducts = async () => {
    setBusy('products');
    try {
      await api(`/appointments/${id}/products`, {
        method: 'POST',
        body: { items: usedList.map((u) => ({ productId: u.productId, quantity: Number(u.quantity) || 0, unit: u.unit, applicationMethod: u.applicationMethod || null })) },
      });
      notify('Products saved', usedList.length ? `${usedList.length} product${usedList.length === 1 ? '' : 's'} recorded for this visit.` : 'No products recorded.');
      void qc.invalidateQueries({ queryKey: ['appointment', id] });
    } catch (e) {
      notify('Could not save products', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !appt) return <Loading />;

  const name = appt.customerCompany ?? `${appt.customerFirstName} ${appt.customerLastName}`;
  const total = appt.services.reduce((a, s) => a + s.unitPrice * s.quantity, 0);
  const active = ['scheduled', 'en_route', 'arrived', 'in_progress'].includes(appt.status);

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <Row>
            <Text style={styles.name}>{name}</Text>
            <StatusBadge status={appt.status} />
          </Row>
          <Text style={styles.addr}>
            {appt.addressLine1}, {appt.city}, {appt.state} {appt.postalCode}
          </Text>
          <Text style={styles.window}>
            {fmtTime(appt.windowStart)} – {fmtTime(appt.windowEnd)}
          </Text>
          {appt.customerPhone ? <Text style={styles.phone}>{appt.customerPhone}</Text> : null}
          {appt.accessNotes ? <Text style={styles.access}>Access: {appt.accessNotes}</Text> : null}
          <View style={{ marginTop: 8 }}>
            {appt.recurringChargeId && appt.services.length === 0 ? (
              <Row><Value>Regular recurring service{appt.recurringFrequency ? ` · ${appt.recurringFrequency}` : ''}</Value><Value style={{ fontWeight: '700' }}>{money(appt.recurringAmount ?? 0)}</Value></Row>
            ) : null}
            {appt.services.map((s, i) => (
              <Row key={i} style={{ marginVertical: 2 }}>
                <Value>{s.name} ×{s.quantity}</Value>
                <Value style={{ fontWeight: '700' }}>{money(s.unitPrice * s.quantity)}</Value>
              </Row>
            ))}
            <Row style={{ marginTop: 4 }}>
              <Value style={{ fontWeight: '800' }}>Estimated Total</Value>
              <Value style={{ fontWeight: '800' }}>{money(total)}</Value>
            </Row>
          </View>
          <Button
            title="View Customer"
            variant="outline"
            onPress={() => router.push(`/customer/${appt.customerId}`)}
            style={{ marginTop: 10 }}
          />
        </Card>

        {active && appt.latitude != null && appt.longitude != null ? (
          <Button
            title="Start Navigation"
            variant="secondary"
            onPress={() => openNavigation(appt.latitude!, appt.longitude!, name)}
          />
        ) : null}

        {appt.status === 'scheduled' && (
          <Button title="On My Way" onPress={() => setStatus('en_route')} loading={busy === 'en_route'} />
        )}
        {appt.status === 'en_route' && (
          <Button title="Arrived" onPress={() => setStatus('arrived')} loading={busy === 'arrived'} />
        )}
        {appt.status === 'arrived' && (
          <Button title="Start Service" onPress={() => setStatus('in_progress')} loading={busy === 'in_progress'} />
        )}
        {(appt.status === 'en_route' || appt.status === 'arrived') && (
          <Button title="No Access" variant="danger" onPress={() => setStatus('no_access')} loading={busy === 'no_access'} />
        )}

        {(appt.status === 'in_progress' || appt.status === 'arrived' || appt.status === 'completed') && (
          <>
            <SectionTitle>Products Used ({usedList.length})</SectionTitle>
            <Card>
              <Text style={styles.productHint}>Tap the products applied on this visit. They print on the customer's service report.</Text>
              <View style={styles.productGrid}>
                {(catalog.data?.items ?? []).map((c) => {
                  const on = usedList.some((u) => u.productId === c.id);
                  return (
                    <TouchableOpacity key={c.id} style={[styles.productChip, on && styles.productChipOn]} onPress={() => toggleProduct(c)}>
                      <Text style={[styles.productChipText, on && styles.productChipTextOn]}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {usedList.map((u) => (
                <View key={u.productId} style={styles.usedRow}>
                  <Text style={styles.usedName}>{u.name}</Text>
                  <View style={styles.usedInputs}>
                    <TextInput style={styles.qtyInput} keyboardType="decimal-pad" value={u.quantity} onChangeText={(quantity) => updateUsed(u.productId, { quantity })} />
                    <Text style={styles.unitText}>{u.unit}</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.methodRow} contentContainerStyle={{ alignItems: 'center' }}>
                    {(catalog.data?.applicationMethods ?? []).map((m) => (
                      <TouchableOpacity key={m} style={[styles.methodChip, u.applicationMethod === m && styles.methodChipOn]} onPress={() => updateUsed(u.productId, { applicationMethod: u.applicationMethod === m ? '' : m })}>
                        <Text style={[styles.methodText, u.applicationMethod === m && styles.methodTextOn]}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ))}
              <Button title="Save Products" variant="outline" onPress={() => void saveProducts()} loading={busy === 'products'} />
            </Card>
          </>
        )}

        {(appt.status === 'in_progress' || appt.status === 'arrived') && (
          <>
            <SectionTitle>Service Notes</SectionTitle>
            <Card>
              <TextInput
                style={styles.noteInput}
                placeholder="Add a service note…"
                placeholderTextColor={colors.textMuted}
                multiline
                value={noteText}
                onChangeText={setNoteText}
              />
              <Button title="Save Note" variant="outline" onPress={addNote} loading={busy === 'note'} disabled={!noteText.trim()} />
            </Card>

            <SectionTitle>Photos ({(photos?.items?.length ?? 0) + localPhotos.length})</SectionTitle>
            <Row>
              <Button title="Take Photo" onPress={() => takePhoto(true)} loading={busy === 'photo'} style={{ flex: 1, marginRight: 6 }} />
              <Button title="From Library" variant="outline" onPress={() => takePhoto(false)} style={{ flex: 1, marginLeft: 6 }} />
            </Row>
            {localPhotos.length > 0 && (
              <ScrollView horizontal style={{ marginVertical: 6 }}>
                {localPhotos.map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.thumb} />
                ))}
              </ScrollView>
            )}

            <SectionTitle>Signature {signatures?.length ? '✓ Captured' : ''}</SectionTitle>
            <Button
              title={signatures?.length ? 'Re-capture Signature' : 'Capture Signature'}
              variant="outline"
              onPress={() => router.push({ pathname: '/signature', params: { appointmentId: id, customerId: appt.customerId } })}
            />

            {appt.status === 'in_progress' && (
              <Button title="Complete Service" variant="success" onPress={complete} loading={busy === 'complete'} style={{ marginTop: 16 }} />
            )}
          </>
        )}

        {appt.status === 'completed' && appt.invoiceId ? (
          <Button title="View Invoice / Collect Payment" variant="success" onPress={() => router.push(`/invoice/${appt.invoiceId}`)} />
        ) : null}

        {notes?.items?.length ? (
          <>
            <SectionTitle>Notes History</SectionTitle>
            {notes.items.map((n) => (
              <Card key={n.id}>
                <Text style={styles.noteBody}>{n.body}</Text>
                <Text style={styles.noteMeta}>{n.authorName}</Text>
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  productHint: { fontSize: 12, color: colors.textMuted, marginBottom: 8, lineHeight: 16 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  productChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#fff' },
  productChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  productChipText: { fontSize: 12, fontWeight: '700', color: colors.text },
  productChipTextOn: { color: '#0D0D0D', fontWeight: '800' },
  usedRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, marginTop: 6 },
  usedName: { fontWeight: '800', color: colors.text, fontSize: 13 },
  usedInputs: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  qtyInput: { width: 70, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 6, color: colors.text, backgroundColor: '#fff' },
  unitText: { marginLeft: 8, color: colors.textMuted, fontWeight: '700' },
  methodRow: { flexGrow: 0, flexShrink: 0, height: 34, marginTop: 6 },
  methodChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 9, marginRight: 6, backgroundColor: '#fff' },
  methodChipOn: { backgroundColor: '#E8F6F2', borderColor: colors.primary },
  methodText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  methodTextOn: { color: colors.primaryDark },
  container: { padding: 16, paddingBottom: 60 },
  name: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1, marginRight: 8 },
  addr: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  window: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 },
  phone: { fontSize: 14, color: colors.info, marginTop: 2 },
  access: { fontSize: 13, color: colors.warning, marginTop: 4, fontStyle: 'italic' },
  noteInput: {
    minHeight: 70,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  thumb: { width: 72, height: 72, borderRadius: 8, marginRight: 8 },
  noteBody: { fontSize: 14, color: colors.text },
  noteMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
