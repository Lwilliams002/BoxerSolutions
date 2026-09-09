import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { notify } from '../../src/lib/confirm';
import { colors } from '../../src/lib/theme';
import { Button, Card, Label, Loading, Row, Value } from '../../src/components/ui';

interface Product { id: string; name: string; unit: string; epaRegistrationNo: string | null; defaultQuantity: string | number; active: boolean }

/** Product / chemical catalog for the stop screen and customer service reports. */
export default function ProductsAdminScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['products', 'all'], queryFn: () => api<{ items: Product[] }>('/products?all=1') });
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('oz');
  const [epa, setEpa] = useState('');
  const [qty, setQty] = useState('1');

  const add = useMutation({
    mutationFn: () => api('/products', { method: 'POST', body: { name: name.trim(), unit: unit.trim() || 'oz', epaRegistrationNo: epa.trim() || null, defaultQuantity: Number(qty) || 1 } }),
    onSuccess: () => { setName(''); setEpa(''); setQty('1'); void qc.invalidateQueries({ queryKey: ['products'] }); notify('Product added'); },
    onError: (e) => notify('Could not add product', (e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/products/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => notify('Could not update product', (e as Error).message),
  });

  if (query.isLoading) return <Loading />;
  const items = query.data?.items ?? [];

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
      <Text style={styles.title}>Products</Text>
      <Text style={styles.hint}>Products technicians can record on a visit. They print on the customer's service notification with quantity and application method.</Text>

      <Card>
        <Label>Product name</Label>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Suspend SC" placeholderTextColor={colors.textMuted} />
        <Row>
          <View style={{ flex: 1, marginRight: 8 }}><Label>Unit</Label><TextInput style={styles.input} value={unit} onChangeText={setUnit} placeholder="oz" placeholderTextColor={colors.textMuted} /></View>
          <View style={{ flex: 1, marginLeft: 8 }}><Label>Default quantity</Label><TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" /></View>
        </Row>
        <Label>EPA registration # (optional)</Label>
        <TextInput style={styles.input} value={epa} onChangeText={setEpa} placeholder="e.g. 432-763" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
        <Button title="Add product" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} />
      </Card>

      {items.map((p) => (
        <Card key={p.id}>
          <Row>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Value style={{ fontWeight: '800', color: p.active ? colors.text : colors.textMuted }}>{p.name}</Value>
              <Text style={styles.meta}>{Number(p.defaultQuantity)} {p.unit} default{p.epaRegistrationNo ? ` · EPA ${p.epaRegistrationNo}` : ''}</Text>
            </View>
            <Switch value={p.active} onValueChange={(active) => toggle.mutate({ id: p.id, active })} trackColor={{ true: colors.primary }} />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '900', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 13, color: colors.textMuted, marginBottom: 14, lineHeight: 18 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
