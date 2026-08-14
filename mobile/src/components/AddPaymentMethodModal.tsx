import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { colors } from '../lib/theme';
import { Button } from './ui';

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
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  const [error, setError] = useState<string | null>(null);

  const digits = number.replace(/\D/g, '');
  const brand = useMemo(() => detectBrand(digits), [digits]);

  const reset = () => {
    setNumber('');
    setName('');
    setExp('');
    setCvv('');
    setZip('');
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

  const submit = async () => {
    setError(null);
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

    // Client-side "tokenization": only a token derived from brand + last4 +
    // expiry is sent to the backend — never the full PAN or CVV.
    const last4 = digits.slice(-4);
    const token = `tok_${brand.key}_${last4}_${mm}_${yy}`;
    await onSubmit(token);
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Add Payment Method</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
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

              {error && <Text style={styles.error}>{error}</Text>}

              <Text style={styles.secure}>🔒 Card details are tokenized on-device. Only the card brand, last 4 digits and expiry are stored.</Text>

              <Button title="Save Card" onPress={submit} loading={saving} style={{ marginTop: 12 }} />
              <TouchableOpacity onPress={close} style={styles.cancel} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '90%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
});
