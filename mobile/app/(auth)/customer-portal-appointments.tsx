import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalAppointment, Paginated, ServiceMediaItem } from '../../src/lib/types';
import { colors } from '../../src/lib/theme';
import { ServiceMediaGrid } from '../../src/components/ServiceMediaGrid';

/** Proof-of-service photos and videos for one completed visit, loaded when opened. */
function VisitMedia({ appointmentId }: { appointmentId: string }) {
  const q = useQuery({
    queryKey: ['portal-media', appointmentId],
    queryFn: () => customerPortalApi<{ items: ServiceMediaItem[] }>(`/media?appointmentId=${appointmentId}`),
  });
  if (q.isLoading) return <Text style={styles.meta}>Loading photos…</Text>;
  if (!q.data?.items?.length) return <Text style={styles.meta}>No photos for this visit.</Text>;
  return <ServiceMediaGrid items={q.data.items} />;
}

export default function CustomerPortalAppointmentsScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['portal-appointments-all'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalAppointment>>('/appointments?page=1&pageSize=50'),
  });

  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((appt) => {
        const count = Number(appt.media_count ?? 0);
        const open = openId === appt.id;
        return (
          <Card key={appt.id}>
            <Text style={styles.date}>{appt.scheduled_date}</Text>
            <Text style={styles.meta}>{appt.window_start.slice(0, 5)}-{appt.window_end.slice(0, 5)} · {appt.status}</Text>
            <Text style={styles.meta}>{appt.address_line1}, {appt.city}, {appt.state}</Text>
            <Text style={styles.service}>{appt.service_names || 'Service visit'}</Text>
            {appt.status === 'completed' && count > 0 ? (
              <>
                <TouchableOpacity style={styles.mediaBtn} onPress={() => setOpenId(open ? null : appt.id)} activeOpacity={0.85}>
                  <Text style={styles.mediaBtnText}>{open ? 'Hide' : 'View'} {count} photo{count === 1 ? '' : 's'} & video from this visit</Text>
                </TouchableOpacity>
                {open ? <VisitMedia appointmentId={appt.id} /> : null}
              </>
            ) : null}
          </Card>
        );
      })}
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
  mediaBtn: { marginTop: 10, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  mediaBtnText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  empty: { color: '#fff', textAlign: 'center', marginTop: 30 },
});
