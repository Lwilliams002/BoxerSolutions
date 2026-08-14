import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors, fmtDate } from '../../src/lib/theme';
import { Card, EmptyState, Label, Loading, Row, Value } from '../../src/components/ui';
import { Paginated } from '../../src/lib/types';

type AuditLog = { id: string; action: string; entityType: string; entityId: string | null; userName: string | null; userEmail: string | null; createdAt: string };

export default function AdminAuditScreen() {
  const query = useQuery({ queryKey: ['audit-logs'], queryFn: () => api<Paginated<AuditLog>>('/audit-logs?pageSize=100') });
  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
      <Text style={styles.title}>Audit Logs</Text>
      {items.length === 0 ? <EmptyState title="No audit logs" /> : items.map((a) => (
        <Card key={a.id}>
          <Row><Value style={styles.action}>{a.action}</Value><Text style={styles.date}>{fmtDate(a.createdAt)}</Text></Row>
          <View style={styles.grid}><View><Label>Entity</Label><Value>{a.entityType}</Value></View><View><Label>User</Label><Value>{a.userName ?? a.userEmail ?? 'System'}</Value></View></View>
          {a.entityId ? <Text style={styles.meta}>{a.entityId}</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, paddingBottom: 40 }, title: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 16 }, action: { fontWeight: '900', flex: 1 }, date: { color: colors.textMuted, fontSize: 12 }, grid: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 }, meta: { color: colors.textMuted, fontSize: 11, marginTop: 10 } });
