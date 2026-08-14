import React, { useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors, money } from '../../src/lib/theme';
import { Button, Card, EmptyState, Label, Loading, Row, StatusBadge, Value } from '../../src/components/ui';
import { Paginated } from '../../src/lib/types';

type Category = { id: string; name: string };
type Service = { id: string; name: string; description: string | null; categoryId: string | null; categoryName?: string; price: string | number; cost: string | number; durationMinutes: number; taxable: boolean; isRecurring: boolean; isActive: boolean };
type Form = { name: string; description: string; categoryId: string | null; price: string; cost: string; durationMinutes: string; taxable: boolean; isRecurring: boolean; isActive: boolean };

const emptyForm: Form = { name: '', description: '', categoryId: null, price: '0', cost: '0', durationMinutes: '30', taxable: true, isRecurring: false, isActive: true };

function toForm(s?: Service): Form {
  if (!s) return emptyForm;
  return { name: s.name, description: s.description ?? '', categoryId: s.categoryId, price: String(s.price ?? 0), cost: String(s.cost ?? 0), durationMinutes: String(s.durationMinutes ?? 30), taxable: s.taxable !== false, isRecurring: !!s.isRecurring, isActive: !!s.isActive };
}

function body(form: Form) {
  return { ...form, description: form.description || null, price: Number(form.price) || 0, cost: Number(form.cost) || 0, durationMinutes: Number(form.durationMinutes) || 30 };
}

export default function AdminServicesScreen() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [open, setOpen] = useState(false);
  const services = useQuery({ queryKey: ['admin-services'], queryFn: () => api<Paginated<Service>>('/services?pageSize=200') });
  const categories = useQuery({ queryKey: ['service-categories'], queryFn: () => api<Category[]>('/services/categories') });
  const save = useMutation({
    mutationFn: () => editing ? api<Service>(`/services/${editing.id}`, { method: 'PATCH', body: body(form) }) : api<Service>('/services', { method: 'POST', body: body(form) }),
    onSuccess: async () => { setOpen(false); setEditing(null); await qc.invalidateQueries({ queryKey: ['admin-services'] }); },
    onError: (e: Error) => Alert.alert('Save failed', e.message),
  });
  const toggle = useMutation({
    mutationFn: (s: Service) => api<Service>(`/services/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin-services'] }),
    onError: (e: Error) => Alert.alert('Update failed', e.message),
  });
  const refreshing = services.isRefetching || categories.isRefetching;
  if (services.isLoading || categories.isLoading) return <Loading />;
  const items = services.data?.items ?? [];
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const startEdit = (s: Service) => { setEditing(s); setForm(toForm(s)); setOpen(true); };
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void services.refetch(); void categories.refetch(); }} tintColor={colors.primary} />}>
      <Row style={{ marginBottom: 12 }}><Text style={styles.title}>Service Catalog</Text><Button title="New" onPress={startCreate} style={styles.smallButton} /></Row>
      {items.length === 0 ? <EmptyState title="No services" /> : items.map((s) => (
        <TouchableOpacity key={s.id} onPress={() => startEdit(s)} activeOpacity={0.75}>
          <Card>
            <Row><Value style={styles.name}>{s.name}</Value><StatusBadge status={s.isActive ? 'active' : 'inactive'} /></Row>
            <Text style={styles.meta}>{s.categoryName ?? 'Uncategorized'} • {money(s.price)} • {s.durationMinutes} min</Text>
            <View style={styles.badges}>{s.isRecurring && <StatusBadge status="recurring" />}{s.taxable ? <StatusBadge status="taxable" /> : <StatusBadge status="non taxable" />}</View>
            <Button title={s.isActive ? 'Deactivate' : 'Reactivate'} variant={s.isActive ? 'outline' : 'success'} onPress={() => toggle.mutate(s)} />
          </Card>
        </TouchableOpacity>
      ))}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <ScrollView contentContainerStyle={styles.modal}>
          <Text style={styles.title}>{editing ? 'Edit Service' : 'New Service'}</Text>
          <Label>Name</Label><TextInput style={styles.input} value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
          <Label>Description</Label><TextInput style={[styles.input, styles.textArea]} value={form.description} multiline onChangeText={(description) => setForm({ ...form, description })} />
          <Label>Category</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {categories.data?.map((c) => <TouchableOpacity key={c.id} style={[styles.chip, form.categoryId === c.id && styles.chipActive]} onPress={() => setForm({ ...form, categoryId: c.id })}><Text style={[styles.chipText, form.categoryId === c.id && styles.chipTextActive]}>{c.name}</Text></TouchableOpacity>)}
          </ScrollView>
          <Row><View style={styles.half}><Label>Price</Label><TextInput style={styles.input} keyboardType="decimal-pad" value={form.price} onChangeText={(price) => setForm({ ...form, price })} /></View><View style={styles.half}><Label>Cost</Label><TextInput style={styles.input} keyboardType="decimal-pad" value={form.cost} onChangeText={(cost) => setForm({ ...form, cost })} /></View></Row>
          <Label>Duration Minutes</Label><TextInput style={styles.input} keyboardType="number-pad" value={form.durationMinutes} onChangeText={(durationMinutes) => setForm({ ...form, durationMinutes })} />
          {(['taxable', 'isRecurring', 'isActive'] as const).map((key) => <Row key={key} style={styles.switchRow}><Value>{key === 'isRecurring' ? 'Recurring' : key === 'isActive' ? 'Active' : 'Taxable'}</Value><Switch value={form[key]} onValueChange={(v) => setForm({ ...form, [key]: v })} /></Row>)}
          <Button title="Save Service" onPress={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()} />
          <Button title="Cancel" variant="outline" onPress={() => setOpen(false)} />
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 }, modal: { padding: 16, paddingBottom: 40, backgroundColor: colors.bg },
  title: { fontSize: 24, fontWeight: '900', color: colors.text }, smallButton: { paddingVertical: 10, paddingHorizontal: 16 },
  name: { fontWeight: '900', flex: 1, marginRight: 8 }, meta: { color: colors.textMuted, marginTop: 8 }, badges: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text }, textArea: { minHeight: 80, textAlignVertical: 'top' },
  half: { width: '48%' }, switchRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chips: { minHeight: 48, marginBottom: 12 }, chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, height: 40 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.textMuted, fontWeight: '700' }, chipTextActive: { color: colors.text },
});
