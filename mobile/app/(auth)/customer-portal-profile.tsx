import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalMe } from '../../src/lib/types';
import { colors, money } from '../../src/lib/theme';

export default function CustomerPortalProfileScreen() {
  const query = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => customerPortalApi<CustomerPortalMe>('/me'),
  });

  if (query.isLoading) return <Loading />;
  if (!query.data) return null;
  const c = query.data;
  const address = [c.address_line1, c.address_line2, c.city, c.state, c.postal_code].filter(Boolean).join(', ');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.section}>Account</Text>
        <Text style={styles.line}>{c.first_name} {c.last_name}</Text>
        <Text style={styles.meta}>{c.email ?? 'No email on file'}</Text>
        <Text style={styles.meta}>{c.phone ?? 'No phone on file'}</Text>
      </Card>

      <Card>
        <Text style={styles.section}>Service Address</Text>
        <Text style={styles.line}>{address || 'No service address on file'}</Text>
      </Card>

      <Card>
        <Text style={styles.section}>Billing</Text>
        <Text style={styles.line}>Current Balance: {money(c.balance)}</Text>
        <Text style={styles.meta}>AutoPay: {c.autopay_enabled ? 'Enabled' : 'Disabled'}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 24 },
  section: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 8 },
  line: { color: colors.text, marginBottom: 4 },
  meta: { color: colors.textMuted, marginBottom: 4 },
});
