import React, { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors } from '../../src/lib/theme';
import { Button, Label, Loading } from '../../src/components/ui';

type Settings = { companyName: string; phone: string; address: string; licenseNumber: string; defaultTaxRate: number; invoiceDueDays: number; appointmentReminderHours: number };
type Form = Omit<Settings, 'defaultTaxRate' | 'invoiceDueDays' | 'appointmentReminderHours'> & { defaultTaxRate: string; invoiceDueDays: string; appointmentReminderHours: string };

function toForm(s: Settings): Form { return { ...s, defaultTaxRate: String(s.defaultTaxRate * 100), invoiceDueDays: String(s.invoiceDueDays), appointmentReminderHours: String(s.appointmentReminderHours) }; }
function toBody(f: Form): Settings { return { ...f, defaultTaxRate: (Number(f.defaultTaxRate) || 0) / 100, invoiceDueDays: Number(f.invoiceDueDays) || 0, appointmentReminderHours: Number(f.appointmentReminderHours) || 0 }; }

export default function AdminSettingsScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);
  const save = useMutation({ mutationFn: () => api<Settings>('/settings', { method: 'PUT', body: toBody(form!) }), onSuccess: async (data) => { setForm(toForm(data)); await qc.invalidateQueries({ queryKey: ['settings'] }); Alert.alert('Saved', 'Company settings updated.'); }, onError: (e: Error) => Alert.alert('Save failed', e.message) });
  if (query.isLoading || !form) return <Loading />;
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
      <Text style={styles.title}>Company Settings</Text>
      <Label>Company Name</Label><TextInput style={styles.input} value={form.companyName} onChangeText={(companyName) => setForm({ ...form, companyName })} />
      <Label>Phone</Label><TextInput style={styles.input} value={form.phone} keyboardType="phone-pad" onChangeText={(phone) => setForm({ ...form, phone })} />
      <Label>Address</Label><TextInput style={[styles.input, styles.textArea]} value={form.address} multiline onChangeText={(address) => setForm({ ...form, address })} />
      <Label>License Number</Label><TextInput style={styles.input} value={form.licenseNumber} onChangeText={(licenseNumber) => setForm({ ...form, licenseNumber })} />
      <Label>Default Tax Rate (%)</Label><TextInput style={styles.input} keyboardType="decimal-pad" value={form.defaultTaxRate} onChangeText={(defaultTaxRate) => setForm({ ...form, defaultTaxRate })} />
      <Label>Invoice Due Days</Label><TextInput style={styles.input} keyboardType="number-pad" value={form.invoiceDueDays} onChangeText={(invoiceDueDays) => setForm({ ...form, invoiceDueDays })} />
      <Label>Appointment Reminder Hours</Label><TextInput style={styles.input} keyboardType="number-pad" value={form.appointmentReminderHours} onChangeText={(appointmentReminderHours) => setForm({ ...form, appointmentReminderHours })} />
      <Button title="Save Settings" onPress={() => save.mutate()} loading={save.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, paddingBottom: 40 }, title: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 16 }, input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text }, textArea: { minHeight: 80, textAlignVertical: 'top' } });
