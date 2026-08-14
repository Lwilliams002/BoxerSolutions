import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { colors, fmtDate } from '../src/lib/theme';
import { Card, EmptyState, Loading, Row, StatusBadge, Value } from '../src/components/ui';

interface NotificationRow {
  id: string;
  channel: string;
  notificationType: string;
  title: string;
  body: string | null;
  status: string;
  createdAt: string;
  readAt: string | null;
}

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationRow[] }>('/notifications?pageSize=50'),
  });

  const markRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST', body: {} });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  if (isLoading) return <Loading />;
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        {items.length === 0 ? (
          <EmptyState title="No notifications" />
        ) : (
          items.map((n) => (
            <Card key={n.id} style={n.status !== 'read' ? styles.unreadCard : undefined}>
              <Row>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Value style={{ fontWeight: '800' }}>{n.title}</Value>
                  {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
                  <Text style={styles.meta}>
                    {n.notificationType.replace(/_/g, ' ')} · {n.channel.toUpperCase()} · {fmtDate(n.createdAt)}
                  </Text>
                </View>
                <StatusBadge status={n.status} />
              </Row>
              {n.status !== 'read' ? (
                <TouchableOpacity onPress={() => markRead(n.id)} style={styles.readButton}>
                  <Text style={styles.readText}>Mark as read</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  unreadCard: { borderWidth: 1.5, borderColor: colors.primary },
  body: { fontSize: 14, color: colors.text, marginTop: 4, lineHeight: 19 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 6, textTransform: 'capitalize' },
  readButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  readText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
});
