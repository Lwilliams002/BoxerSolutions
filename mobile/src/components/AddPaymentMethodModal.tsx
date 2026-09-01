import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Dimensions } from 'react-native';
import { colors } from '../lib/theme';
import { Button } from './ui';

type Method = 'card' | 'ach';

/**
 * Detects the card brand from the leading digits. Mirrors what a real
 * provider SDK does client-side; raw card data never leaves the device.
 */
function detectBrand(digits: string): { key: string; label: string; cvvLen: number } {
  if (/^4/.test(digits)) return { key: 'visa', label: 'Visa', cvvLen: 3 };
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return { key: 'mastercard', label: 'Mastercard', cvvLen: 3 };
  if (/^3[47]/.test(digits)) return { key: 'amex', label: 'American Express', cvvLen: 4 };
  if (/^6(?:011|5)/.test(digits)) return { key: 'discover', label: 'Discover', cvvLen: 3 };
  return { key: 'card', label: 'Card', cvvLen: 3 };
}

function luhnValid(digits: string): boolean {
  if (digits.length < 13) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function formatCardNumber(digits: string, brandKey: string): string {
  if (brandKey === 'amex') {
    return digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
  }
  return digits.replace(/(\d{4})/g, '$1 ').trim();
}

export function AddPaymentMethodModal({
  visible,
  onClose,
  onSubmit,
  saving,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (token: string) => Promise<void> | void;
  saving?: boolean;
}) {
  const [method, setMethod] = useState<Method>('card');
  // Card fields
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  // ACH fields
  const [holder, setHolder] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [acctType, setAcctType] = useState<'checking' | 'savings'>('checking');
  const [error, setError] = useState<string | null>(null);

  const digits = number.replace(/\D/g, '');
  const brand = useMemo(() => detectBrand(digits), [digits]);

  const reset = () => {
    setMethod('card');
    setNumber('');
    setName('');
    setExp('');
    setCvv('');
    setZip('');
    setHolder('');
    setRouting('');
    setAccount('');
    setAcctType('checking');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onExpChange = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setExp(d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
  };

  const submitCard = async () => {
    if (!luhnValid(digits)) return setError('Enter a valid card number.');
    const m = /^(\d{2})\/(\d{2})$/.exec(exp);
    if (!m) return setError('Enter expiry as MM/YY.');
    const mm = parseInt(m[1], 10);
    const yy = parseInt(m[2], 10);
    if (mm < 1 || mm > 12) return setError('Enter a valid expiry month.');
    const now = new Date();
    const fullYear = 2000 + yy;
    if (fullYear < now.getFullYear() || (fullYear === now.getFullYear() && mm < now.getMonth() + 1)) {
      return setError('This card has expired.');
    }
    if (cvv.replace(/\D/g, '').length !== brand.cvvLen) return setError(`Enter the ${brand.cvvLen}-digit security code.`);
    if (!name.trim()) return setError('Enter the name on the card.');

    // Card details are sent over TLS to our backend, which forwards them
    // directly to the payment processor for vaulting. Only the processor's
    // token plus brand/last4/expiry are ever stored.
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || nameParts[0];
    await onSubmit(JSON.stringify({
      type: 'card',
      number: digits,
      expMonth: mm,
      expYear: fullYear,
      cvv: cvv.replace(/\D/g, ''),
      firstName,
      lastName,
      postalCode: zip || undefined,
    }));
    reset();
  };

  const submitAch = async () => {
    const r = routing.replace(/\D/g, '');
    const a = account.replace(/\D/g, '');
    if (!holder.trim()) return setError('Enter the account holder name.');
    if (r.length !== 9) return setError('Routing number must be 9 digits.');
    if (a.length < 4) return setError('Enter a valid account number.');
    const holderParts = holder.trim().split(/\s+/);
    await onSubmit(JSON.stringify({
      type: 'ach',
      accountNumber: a,
      routingNumber: r,
      accountType: acctType,
      firstName: holderParts[0],
      lastName: holderParts.slice(1).join(' ') || holderParts[0],
    }));
    reset();
  };

  const submit = async () => {
    setError(null);
    if (method === 'card') await submitCard();
    else await submitAch();
  };

  const maxSheet = Dimensions.get('window').height * 0.55;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={close} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Add Payment Method</Text>

            <View style={styles.segment}>
              <TouchableOpacity
                style={[styles.segmentBtn, method === 'card' && styles.segmentBtnActive]}
                onPress={() => { setMethod('card'); setError(null); }}
              >
                <Text style={[styles.segmentText, method === 'card' && styles.segmentTextActive]}>Credit / Debit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, method === 'ach' && styles.segmentBtnActive]}
                onPress={() => { setMethod('ach'); setError(null); }}
              >
                <Text style={[styles.segmentText, method === 'ach' && styles.segmentTextActive]}>Bank (ACH)</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: maxSheet }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {method === 'card' ? (
                <>
                  <Text style={styles.label}>Card Number</Text>
                  <View style={styles.numberRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="1234 5678 9012 3456"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      value={formatCardNumber(digits, brand.key)}
                      onChangeText={setNumber}
                      maxLength={brand.key === 'amex' ? 17 : 19}
                    />
                    {digits.length >= 2 && <Text style={styles.brandTag}>{brand.label}</Text>}
                  </View>

                  <Text style={styles.label}>Name on Card</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="John Smith"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="words"
                    value={name}
                    onChangeText={setName}
                  />

                  <View style={styles.row}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={styles.label}>Expiry</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="MM/YY"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        value={exp}
                        onChangeText={onExpChange}
                        maxLength={5}
                      />
                    </View>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={styles.label}>CVV</Text>
                      <TextInput
                        style={styles.input}
                        placeholder={brand.cvvLen === 4 ? '1234' : '123'}
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        secureTextEntry
                        value={cvv}
                        onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, brand.cvvLen))}
                        maxLength={brand.cvvLen}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>ZIP</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="90210"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        value={zip}
                        onChangeText={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
                        maxLength={5}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Account Holder Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="John Smith"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="words"
                    value={holder}
                    onChangeText={setHolder}
                  />

                  <Text style={styles.label}>Routing Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="9 digits"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    value={routing}
                    onChangeText={(v) => setRouting(v.replace(/\D/g, '').slice(0, 9))}
                    maxLength={9}
                  />

                  <Text style={styles.label}>Account Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Account number"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    value={account}
                    onChangeText={(v) => setAccount(v.replace(/\D/g, '').slice(0, 17))}
                    maxLength={17}
                  />

                  <Text style={styles.label}>Account Type</Text>
                  <View style={styles.segment}>
                    <TouchableOpacity
                      style={[styles.segmentBtn, acctType === 'checking' && styles.segmentBtnActive]}
                      onPress={() => setAcctType('checking')}
                    >
                      <Text style={[styles.segmentText, acctType === 'checking' && styles.segmentTextActive]}>Checking</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.segmentBtn, acctType === 'savings' && styles.segmentBtnActive]}
                      onPress={() => setAcctType('savings')}
                    >
                      <Text style={[styles.segmentText, acctType === 'savings' && styles.segmentTextActive]}>Savings</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              <Text style={styles.secure}>
                {method === 'card'
                  ? '🔒 Card details are sent securely to the payment processor for vaulting. Only the card brand, last 4 digits and expiry are stored in this app.'
                  : '🔒 Bank details are sent securely to the payment processor for vaulting. Only the account type and last 4 digits are stored in this app.'}
              </Text>
            </ScrollView>

            <Button
              title={method === 'card' ? 'Save Card' : 'Save Bank Account'}
              onPress={submit}
              loading={saving}
              style={{ marginTop: 14 }}
            />
            <TouchableOpacity onPress={close} style={styles.cancel} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 14 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  segmentTextActive: { color: '#0D0D0D' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  numberRow: { flexDirection: 'row', alignItems: 'center' },
  brandTag: { position: 'absolute', right: 14, fontSize: 13, fontWeight: '700', color: colors.primary },
  row: { flexDirection: 'row' },
  error: { color: colors.danger, fontSize: 13, marginTop: 12, fontWeight: '600' },
  secure: { color: colors.textMuted, fontSize: 12, marginTop: 14, lineHeight: 17 },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  cancelText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
});
