import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { colors } from '../../src/lib/theme';
import { Button, Card, Label } from '../../src/components/ui';
import { useCompanyInfo } from '../../src/lib/companyInfo';

const PESTS = ['Ants', 'Roaches', 'Spiders', 'Mosquitoes', 'Fleas / Ticks', 'Termites', 'Rodents', 'Wasps / Hornets', 'Centipedes / Millipedes', 'Other / Not sure'];

/** Public form: anyone can request service without an account. Creates a lead for the office. */
export default function RequestServicePublicScreen() {
  const router = useRouter();
  const company = useCompanyInfo();
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', pest: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    if (!form.name.trim() || form.phone.replace(/\D/g, '').length < 7) {
      setError('Please enter your name and a phone number so we can reach you.');
      return;
    }
    setBusy(true);
    try {
      await api('/public/service-requests', { method: 'POST', body: { ...form, email: form.email.trim() || null, address: form.address.trim() || null, pest: form.pest || null, message: form.message.trim() || null } });
      setDone(true);
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please call us.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={72} color={colors.primary} />
        <Text style={styles.doneTitle}>Request received</Text>
        <Text style={styles.doneText}>Thanks, {form.name.trim().split(' ')[0]}. We'll call {form.phone} shortly to confirm details and schedule your visit.{form.email ? ' A confirmation was sent to your email.' : ''}</Text>
        <Button title="Done" onPress={() => router.replace('/(auth)/login')} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={88}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.title}>Request service</Text>
        <Text style={styles.sub}>Tell us what you're seeing and where. No account needed. We'll call you to confirm pricing and schedule your first visit.</Text>
        <Card>
          <Label>Your name</Label>
          <TextInput style={styles.input} value={form.name} onChangeText={set('name')} autoCapitalize="words" />
          <Label>Phone</Label>
          <TextInput style={styles.input} value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
          <Label>Email (optional)</Label>
          <TextInput style={styles.input} value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
          <Label>Service address</Label>
          <TextInput style={styles.input} value={form.address} onChangeText={set('address')} placeholder="Street, city, ZIP" placeholderTextColor={colors.textMuted} />
          <Label>What are you seeing?</Label>
          <View style={styles.chips}>
            {PESTS.map((p) => (
              <TouchableOpacity key={p} style={[styles.chip, form.pest === p && styles.chipOn]} onPress={() => setForm((f) => ({ ...f, pest: f.pest === p ? '' : p }))}>
                <Text style={[styles.chipText, form.pest === p && styles.chipTextOn]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Label>Tell us more (optional)</Label>
          <TextInput style={[styles.input, styles.textArea]} value={form.message} onChangeText={set('message')} multiline placeholder="Where you're seeing activity, home size, how long it's been going on…" placeholderTextColor={colors.textMuted} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Request my free estimate" onPress={() => void submit()} loading={busy} />
        </Card>
        <Text style={styles.foot}>Prefer to talk? Call {company.phone}. By submitting you agree to be contacted about your request.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 120 },
  title: { fontSize: 26, fontWeight: '900', color: colors.text },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 14, lineHeight: 20 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  chipTextOn: { color: '#0D0D0D', fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700', marginBottom: 10 },
  foot: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 14, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  doneTitle: { fontSize: 24, fontWeight: '900', color: colors.text, marginTop: 12 },
  doneText: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
