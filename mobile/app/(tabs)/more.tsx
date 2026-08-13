import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../src/lib/authStore';
import { useSync } from '../../src/lib/offline';
import { colors } from '../../src/lib/theme';
import { Card, Button, SectionTitle, Row, Value, Label } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';
import { API_BASE_URL } from '../../src/lib/config';

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const { status, pendingCount, flush } = useSync();

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

        <Button title="Sign Out" variant="danger" onPress={confirmLogout} style={{ marginTop: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
});
