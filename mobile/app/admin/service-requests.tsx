import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { Button, Card, StatusBadge } from '../../src/components/ui';
import { colors, fmtDate, money } from '../../src/lib/theme';
import { OwnerServiceRequest, Paginated } from '../../src/lib/types';

interface Tech {
  employeeId: string;
  firstName: string;
  lastName: string;
}

export default function ServiceRequestsAdminScreen() {
  const qc = useQueryClient();
  const canManage = useAuth((s) => s.hasPermission('users:write', 'appointments:write'));
  const [quotedById, setQuotedById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [techById, setTechById] = useState<Record<string, string | null>>({});

  const requests = useQuery({
    queryKey: ['owner-service-requests'],
    queryFn: () => api<Paginated<OwnerServiceRequest>>('/service-requests?page=1&pageSize=50'),
    enabled: canManage,
  });
  const technicians = useQuery({
    queryKey: ['owner-techs'],
    queryFn: () => api<Tech[]>('/users/technicians'),
    enabled: canManage,
  });

  const update = useMutation({
    mutationFn: async (requestId: string) => {
      const selectedTech = techById[requestId];
      const quotedRaw = quotedById[requestId];
      const notes = notesById[requestId];
      const quotedPrice = quotedRaw && quotedRaw.trim() ? Number(quotedRaw) : null;
      if (quotedRaw && (!Number.isFinite(quotedPrice) || quotedPrice! < 0)) {
        throw new Error('Quoted price must be a valid number.');
      }
      await api(`/service-requests/${requestId}`, {
        method: 'PATCH',
        body: {
          assignedTechnicianId: selectedTech ?? null,
          quotedPrice,
          ownerNotes: notes?.trim() ? notes.trim() : null,
          status: selectedTech && quotedPrice != null ? 'scheduled' : 'reviewed',
        },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['owner-service-requests'] });
      Alert.alert('Saved', 'Service request updated.');
    },
    onError: (e) => Alert.alert('Unable to update request', (e as Error).message),
  });

  const pickTech = (requestId: string) => {
    const options = (technicians.data ?? []).slice(0, 8).map((t) => ({
      text: `${t.firstName} ${t.lastName}`,
      onPress: () => setTechById((prev) => ({ ...prev, [requestId]: t.employeeId })),
    }));
    Alert.alert('Assign technician', 'Choose who should handle this request.', [
      ...options,
      { text: 'Unassign', onPress: () => setTechById((prev) => ({ ...prev, [requestId]: null })) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const rows = useMemo(() => requests.data?.items ?? [], [requests.data?.items]);

  if (!canManage) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.customer}>Access restricted</Text>
          <Text style={styles.meta}>You do not have permission to review service requests.</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {rows.map((r) => {
        const selectedTech = techById[r.id] ?? r.assigned_technician_id ?? null;
        const selectedTechName = (technicians.data ?? []).find((t) => t.employeeId === selectedTech);
        const quoteText = quotedById[r.id] ?? (r.quoted_price != null ? String(Number(r.quoted_price).toFixed(2)) : '');
        const notesText = notesById[r.id] ?? (r.owner_notes ?? '');
        return (
          <Card key={r.id}>
            <View style={styles.rowHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer}>{r.customer_name}</Text>
                <Text style={styles.meta}>{r.customer_email ?? 'No email'} · {r.customer_phone ?? 'No phone'}</Text>
                <Text style={styles.meta}>{fmtDate(r.requested_at)} · {r.files.length} photo(s)</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
            <Text style={styles.desc}>{r.description}</Text>
            <TouchableOpacity style={styles.assignBtn} onPress={() => pickTech(r.id)}>
              <Text style={styles.assignText}>
                {selectedTechName ? `Tech: ${selectedTechName.firstName} ${selectedTechName.lastName}` : 'Assign Technician'}
              </Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={quoteText}
              onChangeText={(text) => setQuotedById((prev) => ({ ...prev, [r.id]: text }))}
              keyboardType="decimal-pad"
              placeholder="Quoted price (e.g. 129.00)"
              placeholderTextColor={colors.textMuted}
            />
            {quoteText ? <Text style={styles.quotePreview}>Quote: {money(quoteText)}</Text> : null}
            <TextInput
              style={[styles.input, styles.notes]}
              value={notesText}
              onChangeText={(text) => setNotesById((prev) => ({ ...prev, [r.id]: text }))}
              placeholder="Owner notes"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <Button
              title="Save Assignment"
              onPress={() => update.mutate(r.id)}
              loading={update.isPending}
            />
          </Card>
        );
      })}
      {requests.isLoading ? <Text style={styles.loading}>Loading requests...</Text> : null}
      {!requests.isLoading && !rows.length ? <Text style={styles.loading}>No service requests yet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 24 },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  customer: { color: colors.text, fontWeight: '800', fontSize: 16 },
  meta: { color: colors.textMuted, marginTop: 2, fontSize: 12 },
  desc: { color: colors.text, marginTop: 10, marginBottom: 10 },
  assignBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  assignText: { color: colors.text, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  quotePreview: { color: colors.success, fontWeight: '700', marginBottom: 8 },
  loading: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
});
