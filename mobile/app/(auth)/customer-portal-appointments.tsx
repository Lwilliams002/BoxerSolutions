import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalAppointment, Paginated } from '../../src/lib/types';
import { colors } from '../../src/lib/theme';

export default function CustomerPortalAppointmentsScreen() {
  const query = useQuery({
    queryKey: ['portal-appointments-all'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalAppointment>>('/appointments?page=1&pageSize=50'),
  });

  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((appt) => (
        <Card key={appt.id}>
          <Text style={styles.date}>{appt.scheduled_date}</Text>
          <Text style={styles.meta}>{appt.window_start.slice(0, 5)}-{appt.window_end.slice(0, 5)} · {appt.status}</Text>
          <Text style={styles.meta}>{appt.address_line1}, {appt.city}, {appt.state}</Text>
          <Text style={styles.service}>{appt.service_names || 'Service visit'}</Text>
        </Card>
      ))}
      {items.length === 0 ? <Text style={styles.empty}>No appointments found.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 24 },
  date: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  meta: { color: colors.textMuted, marginBottom: 4 },
  service: { color: colors.text },
  empty: { color: '#fff', textAlign: 'center', marginTop: 30 },
});
