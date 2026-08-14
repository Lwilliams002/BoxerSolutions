import React, { useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors } from '../../src/lib/theme';
import { Button, Card, EmptyState, Label, Loading, Row, StatusBadge, Value } from '../../src/components/ui';

type User = { id: string; email: string; firstName: string; lastName: string; phone: string | null; isActive: boolean; roles: string[] };
type Role = { id: string; code: string; name: string; permissions: string[] };
type Form = { firstName: string; lastName: string; email: string; phone: string; password: string; roleCode: string };
const empty: Form = { firstName: '', lastName: '', email: '', phone: '', password: 'Temp1234!', roleCode: 'TECHNICIAN' };

export default function AdminEmployeesScreen() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<User[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const roleByCode = useMemo(() => Object.fromEntries((roles.data ?? []).map((r) => [r.code, r])), [roles.data]);
  const save = useMutation({
    mutationFn: () => editing
      ? api<User>(`/users/${editing.id}`, { method: 'PATCH', body: { firstName: form.firstName, lastName: form.lastName, phone: form.phone || null, roleCodes: [form.roleCode] } })
      : api<User>('/users', { method: 'POST', body: { firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone || null, password: form.password, roleCodes: [form.roleCode] } }),
    onSuccess: async () => { setOpen(false); setEditing(null); await qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => Alert.alert('Save failed', e.message),
  });
  const toggle = useMutation({
    mutationFn: (u: User) => api<User>(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e: Error) => Alert.alert('Update failed', e.message),
  });
  if (users.isLoading || roles.isLoading) return <Loading />;
  const startCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (u: User) => { setEditing(u); setForm({ firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone ?? '', password: '', roleCode: u.roles[0] ?? 'TECHNICIAN' }); setOpen(true); };
  const showRole = (code: string) => Alert.alert(roleByCode[code]?.name ?? code, (roleByCode[code]?.permissions ?? []).join('\n') || 'No permissions');
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={users.isRefetching || roles.isRefetching} onRefresh={() => { void users.refetch(); void roles.refetch(); }} tintColor={colors.primary} />}>
      <Row style={{ marginBottom: 12 }}><Text style={styles.title}>Employees & Users</Text><Button title="New" onPress={startCreate} style={styles.smallButton} /></Row>
      {(users.data ?? []).length === 0 ? <EmptyState title="No users" /> : users.data?.map((u) => (
        <TouchableOpacity key={u.id} onPress={() => startEdit(u)} activeOpacity={0.75}>
          <Card>
            <Row><Value style={styles.name}>{u.firstName} {u.lastName}</Value><StatusBadge status={u.isActive ? 'active' : 'inactive'} /></Row>
            <Text style={styles.meta}>{u.email}{u.phone ? ` • ${u.phone}` : ''}</Text>
            <View style={styles.badges}>{u.roles.map((r) => <TouchableOpacity key={r} onPress={() => showRole(r)}><StatusBadge status={r} /></TouchableOpacity>)}</View>
            <Button title={u.isActive ? 'Deactivate' : 'Reactivate'} variant={u.isActive ? 'outline' : 'success'} onPress={() => toggle.mutate(u)} />
          </Card>
        </TouchableOpacity>
      ))}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <ScrollView contentContainerStyle={styles.modal}>
          <Text style={styles.title}>{editing ? 'Edit User' : 'New User'}</Text>
          <Label>First Name</Label><TextInput style={styles.input} value={form.firstName} onChangeText={(firstName) => setForm({ ...form, firstName })} />
          <Label>Last Name</Label><TextInput style={styles.input} value={form.lastName} onChangeText={(lastName) => setForm({ ...form, lastName })} />
          <Label>Email</Label><TextInput style={styles.input} value={form.email} editable={!editing} autoCapitalize="none" keyboardType="email-address" onChangeText={(email) => setForm({ ...form, email })} />
          <Label>Phone</Label><TextInput style={styles.input} value={form.phone} keyboardType="phone-pad" onChangeText={(phone) => setForm({ ...form, phone })} />
          {!editing && <><Label>Temp Password</Label><TextInput style={styles.input} value={form.password} secureTextEntry onChangeText={(password) => setForm({ ...form, password })} /></>}
          <Label>Role</Label><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>{roles.data?.map((r) => <TouchableOpacity key={r.code} style={[styles.chip, form.roleCode === r.code && styles.chipActive]} onPress={() => setForm({ ...form, roleCode: r.code })}><Text style={[styles.chipText, form.roleCode === r.code && styles.chipTextActive]}>{r.name}</Text></TouchableOpacity>)}</ScrollView>
          <Button title="Save User" onPress={() => save.mutate()} loading={save.isPending} disabled={!form.firstName || !form.lastName || !form.email || (!editing && form.password.length < 8)} />
          <Button title="Cancel" variant="outline" onPress={() => setOpen(false)} />
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 }, modal: { padding: 16, paddingBottom: 40, backgroundColor: colors.bg }, title: { fontSize: 24, fontWeight: '900', color: colors.text }, smallButton: { paddingVertical: 10, paddingHorizontal: 16 }, name: { fontWeight: '900', flex: 1, marginRight: 8 }, meta: { color: colors.textMuted, marginTop: 8 }, badges: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4, flexWrap: 'wrap' }, input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text }, chips: { minHeight: 48, marginBottom: 12 }, chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, height: 40 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.textMuted, fontWeight: '700' }, chipTextActive: { color: colors.text },
});
