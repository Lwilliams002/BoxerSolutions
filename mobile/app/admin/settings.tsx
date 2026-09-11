import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { notify } from '../../src/lib/confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors } from '../../src/lib/theme';
import { Button, Label, Loading } from '../../src/components/ui';

type Settings = { companyName: string; phone: string; email: string; address: string; licenseNumber: string; defaultTaxRate: number; invoiceDueDays: number; chargeRecurringOnCompletion: boolean; cashDiscountPercent: number; appointmentReminderHours: number };
type Form = Omit<Settings, 'defaultTaxRate' | 'invoiceDueDays' | 'appointmentReminderHours' | 'cashDiscountPercent'> & { defaultTaxRate: string; invoiceDueDays: string; appointmentReminderHours: string; cashDiscountPercent: string };

function toForm(s: Settings): Form { return { ...s, defaultTaxRate: String(s.defaultTaxRate * 100), invoiceDueDays: String(s.invoiceDueDays), appointmentReminderHours: String(s.appointmentReminderHours), cashDiscountPercent: String(s.cashDiscountPercent ?? 0) }; }
function toBody(f: Form): Settings { return { ...f, defaultTaxRate: (Number(f.defaultTaxRate) || 0) / 100, invoiceDueDays: Number(f.invoiceDueDays) || 0, appointmentReminderHours: Number(f.appointmentReminderHours) || 0, cashDiscountPercent: Math.min(10, Math.max(0, Number(f.cashDiscountPercent) || 0)) }; }

export default function AdminSettingsScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);
  useEffect(() => () => { void qc.invalidateQueries({ queryKey: ['company-info'] }); }, [qc]);
  const save = useMutation({ mutationFn: () => api<Settings>('/settings', { method: 'PUT', body: toBody(form!) }), onSuccess: async (data) => { setForm(toForm(data)); await qc.invalidateQueries({ queryKey: ['settings'] }); notify('Saved', 'Company settings updated. Emails and agreements now use these details.'); }, onError: (e: Error) => notify('Save failed', e.message) });
  if (query.isLoading || !form) return <Loading />;
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
      <Text style={styles.title}>Company Settings</Text>
      <Label>Company Name</Label><TextInput style={styles.input} value={form.companyName} onChangeText={(companyName) => setForm({ ...form, companyName })} />
      <Text style={styles.hint}>Printed on customer emails (service notifications) and on service agreements.</Text>
      <Label>Phone</Label><TextInput style={styles.input} value={form.phone} keyboardType="phone-pad" onChangeText={(phone) => setForm({ ...form, phone })} />
      <Label>Customer Service Email</Label><TextInput style={styles.input} value={form.email} keyboardType="email-address" autoCapitalize="none" placeholder="service@boxersolutionspestcontrol.com" placeholderTextColor={colors.textMuted} onChangeText={(email) => setForm({ ...form, email })} />
      <Label>Address</Label><TextInput style={[styles.input, styles.textArea]} value={form.address} multiline placeholder={'20560 NW 17th Ave\nMiami Gardens, FL 33056'} placeholderTextColor={colors.textMuted} onChangeText={(address) => setForm({ ...form, address })} />
      <Label>License Number</Label><TextInput style={styles.input} value={form.licenseNumber} placeholder="Leave blank to print ---------" placeholderTextColor={colors.textMuted} onChangeText={(licenseNumber) => setForm({ ...form, licenseNumber })} />
      <Label>Default Tax Rate (%)</Label><TextInput style={styles.input} keyboardType="decimal-pad" value={form.defaultTaxRate} onChangeText={(defaultTaxRate) => setForm({ ...form, defaultTaxRate })} />
      <Label>Invoice Due Days</Label><TextInput style={styles.input} keyboardType="number-pad" value={form.invoiceDueDays} onChangeText={(invoiceDueDays) => setForm({ ...form, invoiceDueDays })} />
      <Label>Cash / bank payment discount (%)</Label>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={form.cashDiscountPercent} onChangeText={(cashDiscountPercent) => setForm({ ...form, cashDiscountPercent })} />
      <Text style={styles.hint}>Listed prices include card processing. Customers paying by bank account, cash or check get this much off, itemized on the receipt. Cards pay the listed price with no fee added. 0 turns it off.</Text>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Label>Charge recurring service on completion</Label>
          <Text style={styles.hint}>When a tech completes a recurring visit, charge the card or bank on file automatically. Off means the invoice is created and you press Charge yourself.</Text>
        </View>
        <Switch value={!!form.chargeRecurringOnCompletion} onValueChange={(chargeRecurringOnCompletion) => setForm({ ...form, chargeRecurringOnCompletion })} trackColor={{ true: colors.primary }} />
      </View>
      <Label>Appointment Reminder Hours</Label><TextInput style={styles.input} keyboardType="number-pad" value={form.appointmentReminderHours} onChangeText={(appointmentReminderHours) => setForm({ ...form, appointmentReminderHours })} />
      <Button title="Save Settings" onPress={() => save.mutate()} loading={save.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, paddingBottom: 40 }, title: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 6 }, hint: { fontSize: 13, color: colors.textMuted, marginBottom: 14, lineHeight: 18 }, switchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }, input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text }, textArea: { minHeight: 80, textAlignVertical: 'top' } });
