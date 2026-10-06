import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { Button, Label } from './ui';
import { ProspectPin, ProspectStatus, PROSPECT_STATUS_META, PROSPECT_STATUS_ORDER, fmtPinDate, prospectTitle } from '../lib/mapPins';

export interface ProspectDraft {
  status: ProspectStatus;
  notes: string;
  contactName: string;
  contactPhone: string;
  callbackDate: string | null;
  addressLine1: string;
}

interface Props {
  /** Existing pin to update, or null for a brand-new one at `coordinate`. */
  pin: ProspectPin | null;
  address: { addressLine1: string; city: string; state: string; postalCode: string } | null;
  saving?: boolean;
  onSave: (draft: ProspectDraft) => void;
  onConvert?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

function shift(days: number) {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bottom sheet for recording a door knock on a house. */
export function ProspectSheet({ pin, address, saving, onSave, onConvert, onDelete, onClose }: Props) {
  const [status, setStatus] = useState<ProspectStatus>(pin?.status ?? 'not_home');
  const [notes, setNotes] = useState('');
  const [contactName, setContactName] = useState(pin?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(pin?.contactPhone ?? '');
  const [callbackDate, setCallbackDate] = useState<string | null>(pin?.callbackDate ?? null);
  const [addressLine1, setAddressLine1] = useState(pin?.addressLine1 ?? address?.addressLine1 ?? '');
  useEffect(() => { if (status === 'call_back' && !callbackDate) setCallbackDate(shift(1)); }, [status, callbackDate]);

  const title = pin ? prospectTitle(pin) : (address?.addressLine1 || 'New pin');
  const cityLine = pin ? [pin.city, pin.state].filter(Boolean).join(', ') : [address?.city, address?.state].filter(Boolean).join(', ');
  const callbackChoices = [{ label: 'Tomorrow', iso: shift(1) }, { label: 'In 3 days', iso: shift(3) }, { label: 'Next week', iso: shift(7) }];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.headRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                {cityLine ? <Text style={styles.sub}>{cityLine}</Text> : null}
                {pin ? <Text style={styles.sub}>Knocked {pin.knockCount}× · last {fmtPinDate(pin.lastKnockedAt)}{pin.updatedByName ? ` by ${pin.updatedByName}` : ''}</Text> : null}
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>

            <Label>Outcome</Label>
            <View style={styles.chips}>
              {PROSPECT_STATUS_ORDER.map((s) => {
                const meta = PROSPECT_STATUS_META[s];
                const on = status === s;
                return (
                  <TouchableOpacity key={s} style={[styles.chip, on && { backgroundColor: meta.color, borderColor: meta.color }]} onPress={() => setStatus(s)}>
                    <Ionicons name={meta.icon as any} size={15} color={on ? '#fff' : meta.color} />
                    <Text style={[styles.chipText, on && { color: '#fff' }]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {status === 'call_back' ? (
              <>
                <Label>Call back on</Label>
                <View style={styles.chips}>
                  {callbackChoices.map((c) => (
                    <TouchableOpacity key={c.iso} style={[styles.chip, callbackDate === c.iso && styles.chipOn]} onPress={() => setCallbackDate(c.iso)}>
                      <Text style={[styles.chipText, callbackDate === c.iso && styles.chipTextOn]}>{c.label} · {fmtPinDate(c.iso)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            {!pin?.addressLine1 ? (
              <>
                <Label>Address</Label>
                <TextInput style={styles.input} value={addressLine1} onChangeText={setAddressLine1} placeholder="House number and street" placeholderTextColor={colors.textMuted} />
              </>
            ) : null}
            {status !== 'not_home' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Label>Name</Label><TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Who you spoke to" placeholderTextColor={colors.textMuted} /></View>
                <View style={{ flex: 1 }}><Label>Phone</Label><TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" placeholder="Optional" placeholderTextColor={colors.textMuted} /></View>
              </View>
            ) : null}
            <Label>Note</Label>
            <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} multiline placeholder={pin?.notes ? `Last note: ${pin.notes}` : 'e.g. Saw ants by the garage, wants a quote'} placeholderTextColor={colors.textMuted} />

            {pin?.events?.length ? (
              <>
                <Label>History</Label>
                {pin.events.slice(0, 6).map((e) => (
                  <View key={e.id} style={styles.eventRow}>
                    <View style={[styles.eventDot, { backgroundColor: PROSPECT_STATUS_META[e.status as ProspectStatus]?.color ?? colors.success }]} />
                    <Text style={styles.eventText} numberOfLines={2}>
                      {PROSPECT_STATUS_META[e.status as ProspectStatus]?.label ?? 'Became a customer'} · {fmtPinDate(e.createdAt)}{e.createdByName ? ` · ${e.createdByName}` : ''}{e.note ? ` — ${e.note}` : ''}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {pin && onDelete ? (
              <TouchableOpacity style={styles.iconBtn} onPress={onDelete} accessibilityLabel="Remove pin"><Ionicons name="trash-outline" size={20} color={colors.danger} /></TouchableOpacity>
            ) : null}
            {pin && onConvert ? (
              <Button title="Sign up" variant="outline" onPress={onConvert} style={{ flex: 1 }} />
            ) : null}
            <Button
              title={pin ? 'Save knock' : 'Drop pin'}
              onPress={() => onSave({ status, notes: notes.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), callbackDate: status === 'call_back' ? callbackDate : null, addressLine1: addressLine1.trim() })}
              loading={saving}
              style={{ flex: 1.4 }}
            />
          </View>
          {Platform.OS === 'ios' ? <View style={{ height: 10 }} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24, maxHeight: '88%' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '900', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '800', color: colors.text },
  chipTextOn: { color: '#0D0D0D' },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: '#fff', marginBottom: 6 },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  eventText: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 16 },
  iconBtn: { width: 46, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
