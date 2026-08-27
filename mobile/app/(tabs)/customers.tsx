import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api, ApiRequestError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authStore';
import { colors, money } from '../../src/lib/theme';
import { Loading, EmptyState, StatusBadge, Button } from '../../src/components/ui';
import { SyncBanner } from '../../src/components/SyncBanner';

interface CustomerRow {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  balance: string;
  autopayEnabled: boolean;
  primaryAddress: string | null;
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'status=active', label: 'Active' },
  { key: 'status=inactive', label: 'Inactive' },
  { key: 'pastDue=true', label: 'Past Due' },
  { key: 'autopay=true', label: 'AutoPay' },
];

function getCustomerErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Your session expired. Please sign in again.';
    if (error.status === 403) return 'You do not have permission to view customers.';
    if (error.status === 0) return 'The server is unreachable right now. Please try again shortly.';
    if (error.status >= 500) return 'The server returned an error while loading customers.';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong while loading customers.';
}

export default function CustomersScreen() {
  const router = useRouter();
  const hasPermission = useAuth((s) => s.hasPermission);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, isError, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['customers', debounced, filter],
    queryFn: () =>
      api<{ items: CustomerRow[]; total: number }>(
        `/customers?pageSize=50${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}${filter ? `&${filter}` : ''}`,
      ),
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        <SyncBanner />
        <Loading />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1 }}>
        <SyncBanner />
        <EmptyState
          title="Unable to load customers"
          subtitle={getCustomerErrorMessage(error)}
        />
        <View style={styles.retryWrap}>
          <Button title="Retry" onPress={() => void refetch()} loading={isRefetching} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search name, phone, email, address…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={(f) => f.label}
        style={styles.filters}
        contentContainerStyle={{ paddingLeft: 16, paddingRight: 16, alignItems: 'center' }}
        renderItem={({ item: f }) => (
          <TouchableOpacity
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={data?.items ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        ListEmptyComponent={<EmptyState title="No customers found" />}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/customer/${item.id}`)}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>
                {item.company ?? `${item.firstName} ${item.lastName}`}
              </Text>
              <StatusBadge status={item.status} />
            </View>
            {item.primaryAddress ? <Text style={styles.sub}>{item.primaryAddress}</Text> : null}
            <View style={styles.rowBottom}>
              <Text style={styles.sub}>{item.phone ?? item.email ?? `#${item.customerNumber}`}</Text>
              <Text style={[styles.balance, parseFloat(item.balance) > 0 && { color: colors.danger }]}>
                {money(item.balance)}
                {item.autopayEnabled ? '  ⟳' : ''}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {hasPermission('customers:write') && (
        <View style={styles.fabWrap}>
          <Button title="+ New Customer" onPress={() => router.push('/customer/new')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 10 },
  search: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 15,
    color: colors.text,
  },
  filters: { flexGrow: 0, height: 56, marginTop: 8, marginBottom: 4 },
  chip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, lineHeight: 18, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '800' },
  retryWrap: { paddingHorizontal: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  balance: { fontSize: 14, fontWeight: '700', color: colors.success },
  fabWrap: { position: 'absolute', bottom: 16, left: 16, right: 16 },
});
