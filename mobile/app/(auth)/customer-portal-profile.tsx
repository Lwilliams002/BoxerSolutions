import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notify } from '../../src/lib/confirm';
import { Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { CustomerPortalMe } from '../../src/lib/types';
import { colors, money } from '../../src/lib/theme';

export default function CustomerPortalProfileScreen() {
  const qc = useQueryClient();
  const [savingSms, setSavingSms] = useState(false);
  const setSms = async (on: boolean) => {
    setSavingSms(true);
    try {
      await customerPortalApi('/me/sms', { method: 'PATCH', body: { smsOptIn: on } });
      await qc.invalidateQueries({ queryKey: ['portal-profile'] });
      void qc.invalidateQueries({ queryKey: ['portal-me'] });
    } catch (e) {
      notify('Could not update', (e as Error).message);
    } finally {
      setSavingSms(false);
    }
  };
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
        <Text style={styles.section}>Text Message Updates</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[styles.meta, { flex: 1, marginBottom: 0 }]}>
            {c.sms_opt_in ? `Texts are on for ${c.phone ?? 'your number'}: confirmations, reminders, technician on the way and reschedules.` : 'Texts are off. Turn on to get appointment confirmations, reminders and technician-on-the-way alerts by text.'} Msg &amp; data rates may apply. Reply STOP to any text to stop.
          </Text>
          <Switch value={!!c.sms_opt_in} onValueChange={(v) => void setSms(v)} disabled={savingSms || !c.phone} trackColor={{ true: colors.primary }} />
        </View>
        {!c.phone ? <Text style={styles.meta}>Add a mobile number with the office to enable texts.</Text> : null}
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
