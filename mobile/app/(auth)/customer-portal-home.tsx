import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Loading } from '../../src/components/ui';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { useCustomerPortal } from '../../src/lib/customerPortalStore';
import { colors, money } from '../../src/lib/theme';
import { CustomerPortalAppointment, CustomerPortalInvoice, CustomerPortalMe, Paginated } from '../../src/lib/types';

export default function CustomerPortalHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ testMode?: string }>();
  const isTestMode = params.testMode === '1';
  const { hydrated, hydrate, portalSessionToken, clearSession } = useCustomerPortal();

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const me = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => customerPortalApi<CustomerPortalMe>('/me'),
    enabled: hydrated && !!portalSessionToken,
  });
  const upcoming = useQuery({
    queryKey: ['portal-upcoming'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalAppointment>>('/appointments?page=1&pageSize=3'),
    enabled: hydrated && !!portalSessionToken,
  });
  const invoices = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalInvoice>>('/invoices?page=1&pageSize=3'),
    enabled: hydrated && !!portalSessionToken,
  });

  const signOut = async () => {
    await clearSession();
    router.replace('/(auth)/login');
  };

  if (!hydrated) return <Loading />;
  if (!portalSessionToken) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Portal session not found. Please sign in again.</Text>
        <Button title="Back to Login" onPress={() => router.replace('/(auth)/login')} />
      </View>
    );
  }
  if (me.isLoading || upcoming.isLoading || invoices.isLoading) return <Loading />;
  if (me.error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Session expired. Please sign in again.</Text>
        <Button title="Back to Login" onPress={signOut} />
      </View>
    );
  }

  const customer = me.data!;
  const fullName = `${customer.first_name} ${customer.last_name}`;
  const openBalance = Number(customer.balance ?? 0);
  const nextAppointment = upcoming.data?.items[0];
  const openInvoices = (invoices.data?.items ?? []).filter((i) => Number(i.balance_due) > 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandName}>CUSTOMER PORTAL</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.title}>Welcome, {fullName}</Text>
          {isTestMode ? <Text style={styles.badge}>TEST MODE · OTP BYPASSED</Text> : null}
          <Text style={styles.meta}>{customer.email ?? 'No email on file'}</Text>
          <Text style={styles.balanceLabel}>Current Balance</Text>
          <Text style={styles.balance}>{money(openBalance)}</Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Next Appointment</Text>
          {nextAppointment ? (
            <>
              <Text style={styles.line}>{nextAppointment.scheduled_date} · {nextAppointment.window_start.slice(0, 5)}-{nextAppointment.window_end.slice(0, 5)}</Text>
              <Text style={styles.meta}>{nextAppointment.address_line1}, {nextAppointment.city}</Text>
              <Text style={styles.meta}>{nextAppointment.service_names || 'Service visit'}</Text>
            </>
          ) : (
            <Text style={styles.meta}>No appointments scheduled yet.</Text>
          )}
          <Button title="View Appointments" variant="outline" onPress={() => router.push('/(auth)/customer-portal-appointments')} />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Open Invoices</Text>
          {openInvoices.length > 0 ? (
            openInvoices.map((inv) => (
              <Text key={inv.id} style={styles.line}>
                {inv.invoice_number}: {money(inv.balance_due)}
              </Text>
            ))
          ) : (
            <Text style={styles.meta}>No open invoices.</Text>
          )}
          <Button title="View Invoices" variant="outline" onPress={() => router.push('/(auth)/customer-portal-invoices')} />
        </Card>

        <Card>
          <Button title="Profile & Service Address" variant="outline" onPress={() => router.push('/(auth)/customer-portal-profile')} />
          <Button title="Request Service" variant="outline" onPress={() => router.push('/(auth)/customer-portal-request-service')} />
          <Button title="Sign Out" variant="danger" onPress={signOut} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 8 },
  logo: { width: 88, height: 88, marginBottom: 8 },
  brandName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 1.2 },
  content: { padding: 16, paddingBottom: 24 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6, textAlign: 'center' },
  badge: {
    color: '#0D0D0D',
    backgroundColor: '#2DC4A2',
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontWeight: '800',
    fontSize: 11,
    marginBottom: 8,
  },
  meta: { color: colors.textMuted, textAlign: 'center', marginBottom: 4 },
  balanceLabel: { color: colors.textMuted, marginTop: 10, textAlign: 'center' },
  balance: { color: colors.success, fontSize: 28, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  sectionTitle: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 8 },
  line: { color: colors.text, marginBottom: 4 },
  centered: { flex: 1, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center', padding: 20 },
  error: { color: '#fff', marginBottom: 12, textAlign: 'center' },
});
