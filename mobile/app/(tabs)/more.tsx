import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/authStore';
import { useSync } from '../../src/lib/offline';
import { colors } from '../../src/lib/theme';
import { Card, Button, SectionTitle, Row, Value, Label } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { API_BASE_URL } from '../../src/lib/config';

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const canReports = useAuth((state) => state.hasPermission('reports:read'));
  const isOwner = user?.roles?.includes('OWNER');
  const canServicesAdmin = useAuth((state) => state.hasPermission('services:write'));
  const canUsersAdmin = useAuth((state) => state.hasPermission('users:write'));
  const canSettingsAdmin = useAuth((state) => state.hasPermission('settings:write'));
  const { status, pendingCount, flush } = useSync();
  const router = useRouter();

  const confirmLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <ScrollView contentContainerStyle={styles.container}>
        <SectionTitle>Account</SectionTitle>
        <Card>
          <View style={styles.brandRow}>
            <Text style={styles.brandName}>Boxer Solutions Pest Control</Text>
            <Text style={styles.brandSub}>Pest Control</Text>
          </View>
          <Label>Signed in as</Label>
          <Value style={{ fontWeight: '700' }}>
            {user?.firstName} {user?.lastName}
          </Value>
          <Text style={styles.meta}>{user?.email}</Text>
          <Text style={styles.meta}>Roles: {user?.roles.join(', ')}</Text>
        </Card>

        <SectionTitle>Sync</SectionTitle>
        <Card>
          <Row>
            <View>
              <Label>Status</Label>
              <Value style={{ fontWeight: '700', textTransform: 'uppercase' }}>{status}</Value>
            </View>
            <View>
              <Label>Pending</Label>
              <Value style={{ fontWeight: '700' }}>{pendingCount}</Value>
            </View>
          </Row>
          {pendingCount > 0 && (
            <Button title="Retry Sync" variant="outline" onPress={() => void flush()} style={{ marginTop: 8 }} />
          )}
        </Card>

        <SectionTitle>Environment</SectionTitle>
        <Card>
          <Label>API</Label>
          <Value>{API_BASE_URL}</Value>
        </Card>

        {canReports && (
          <>
            <SectionTitle>Analytics</SectionTitle>
            <TouchableOpacity onPress={() => router.push('/reports')} activeOpacity={0.75}>
              <Card>
                <Row>
                  <View>
                    <Value style={{ fontWeight: '800' }}>Reports</Value>
                    <Text style={styles.meta}>View revenue, appointments, AR, and growth</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Row>
              </Card>
            </TouchableOpacity>
          </>
        )}

        {(canServicesAdmin || canUsersAdmin || canSettingsAdmin) && (
          <>
            <SectionTitle>Admin</SectionTitle>
            {canServicesAdmin && (
              <TouchableOpacity onPress={() => router.push('/admin/services')} activeOpacity={0.75}>
                <Card><Row><View><Value style={{ fontWeight: '800' }}>Services</Value><Text style={styles.meta}>Manage service catalog, pricing, and active state</Text></View><Text style={styles.chevron}>›</Text></Row></Card>
              </TouchableOpacity>
            )}
            {canUsersAdmin && (
              <TouchableOpacity onPress={() => router.push('/admin/employees')} activeOpacity={0.75}>
                <Card><Row><View><Value style={{ fontWeight: '800' }}>Employees</Value><Text style={styles.meta}>Manage users, roles, and permissions</Text></View><Text style={styles.chevron}>›</Text></Row></Card>
              </TouchableOpacity>
            )}
            {canSettingsAdmin && (
              <TouchableOpacity onPress={() => router.push('/admin/settings')} activeOpacity={0.75}>
                <Card><Row><View><Value style={{ fontWeight: '800' }}>Company Settings</Value><Text style={styles.meta}>Tax, invoice due days, reminders, and company info</Text></View><Text style={styles.chevron}>›</Text></Row></Card>
              </TouchableOpacity>
            )}
            {canUsersAdmin && (
              <TouchableOpacity onPress={() => router.push('/admin/audit')} activeOpacity={0.75}>
                <Card><Row><View><Value style={{ fontWeight: '800' }}>Audit Logs</Value><Text style={styles.meta}>Review recent administrative activity</Text></View><Text style={styles.chevron}>›</Text></Row></Card>
              </TouchableOpacity>
            )}
            {canUsersAdmin && (
              <TouchableOpacity onPress={() => router.push('/admin/service-requests')} activeOpacity={0.75}>
                <Card><Row><View><Value style={{ fontWeight: '800' }}>Service Requests</Value><Text style={styles.meta}>Review customer requests, assign technicians, and add pricing</Text></View><Text style={styles.chevron}>›</Text></Row></Card>
              </TouchableOpacity>
            )}
          </>
        )}

        <SectionTitle>Activity</SectionTitle>
        {isOwner && (
          <TouchableOpacity onPress={() => router.push('/map')} activeOpacity={0.75}>
            <Card>
              <Row>
                <View>
                  <Value style={{ fontWeight: '800' }}>Territory Map</Value>
                  <Text style={styles.meta}>Assign tech areas and long-press to create customers from map</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Row>
            </Card>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.push('/notifications')} activeOpacity={0.75}>
          <Card>
            <Row>
              <View>
                <Value style={{ fontWeight: '800' }}>Notifications</Value>
                <Text style={styles.meta}>View alerts and mark them read</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Row>
          </Card>
        </TouchableOpacity>

        <Button title="Sign Out" variant="danger" onPress={confirmLogout} style={{ marginTop: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  brandRow: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  brandName: { fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: 0.5 },
  brandSub: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  chevron: { fontSize: 28, color: colors.primaryDark, fontWeight: '300' },
});
