// mobile/src/components/FieldsCheckoutLayout.tsx
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Value } from './ui';
import { colors, money } from '../lib/theme';
import {
  NORTH_SANDBOX_TEST_CARDS, NORTH_SANDBOX_TEST_DETAILS,
  type FieldsConfirmResult, type FieldsFlow, type FieldsPayMode, type FieldsPaySession, type FieldsStoredMethod,
} from '../lib/northFieldsCheckout';

interface Props {
  flow: FieldsFlow;
  mode: FieldsPayMode;
  onModeChange: (mode: FieldsPayMode) => void;
  paySession: FieldsPaySession | null;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  ready: boolean;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  done: FieldsConfirmResult | FieldsStoredMethod | null;
  onSubmit: () => void;
  onCancel: () => void;
  onDone: () => void;
  onRetry: () => void;
  children: React.ReactNode;
}

function isConfirm(done: FieldsConfirmResult | FieldsStoredMethod): done is FieldsConfirmResult {
  return (done as FieldsConfirmResult).status === 'approved';
}

export function FieldsCheckoutLayout(p: Props) {
  const isPay = p.flow === 'pay';
  const b = p.paySession?.breakdown;
  const submitTitle = isPay ? `Pay ${p.paySession ? money(p.paySession.amount) : ''}`.trim() : 'Save Payment Method';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {isPay ? (
        <View style={styles.tabs}>
          {(['card', 'bank'] as FieldsPayMode[]).map((m) => (
            <Pressable key={m} onPress={() => p.onModeChange(m)} disabled={p.loading || p.submitting || !!p.done}
              style={[styles.tab, p.mode === m && styles.tabActive]}>
              <Text style={[styles.tabText, p.mode === m && styles.tabTextActive]}>{m === 'card' ? 'Pay by Card' : 'Pay by Bank (ACH)'}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Card><Value style={styles.title}>Save a payment method on file (no charge)</Value>
          <Text style={styles.muted}>Details are tokenized by North; the number never touches our systems.</Text></Card>
      )}

      {isPay && b ? (
        <Card>
          {[['Subtotal', b.subtotal], ['Taxes & fees', b.tax], ['Total', b.total]].map(([label, v]) => (
            <View key={String(label)} style={styles.row}><Text style={styles.muted}>{label}</Text><Text>{money(v as number)}</Text></View>
          ))}
          {b.previouslyPaid > 0 ? <View style={styles.row}><Text style={styles.muted}>Previously paid</Text><Text>-{money(b.previouslyPaid)}</Text></View> : null}
          <View style={styles.row}><Value style={styles.due}>Amount due today</Value><Value style={styles.due}>{money(b.amountDue)}</Value></View>
        </Card>
      ) : null}

      {p.done ? (
        <Card style={styles.success}>
          {isConfirm(p.done) ? (
            <>
              <Value style={styles.successTitle}>{p.done.duplicate ? 'Payment already recorded' : 'Payment approved'}</Value>
              {p.done.amount != null ? <Value style={styles.amount}>{money(p.done.amount)}</Value> : null}
              {p.done.receipt?.receiptNumber ? <Text style={styles.muted}>Receipt {p.done.receipt.receiptNumber}</Text> : null}
              {p.done.savedMethod ? <Text style={styles.muted}>{p.done.savedMethod.brand}{p.done.savedMethod.last4 ? ` ••••${p.done.savedMethod.last4}` : ''} saved on file</Text> : null}
            </>
          ) : (
            <>
              <Value style={styles.successTitle}>{p.done.duplicate ? 'Already on file' : 'Saved on file'}</Value>
              <Text style={styles.muted}>{p.done.brand}{p.done.last4 ? ` ••••${p.done.last4}` : ''}</Text>
            </>
          )}
        </Card>
      ) : (
        <>
          {p.error ? (
            <Card style={styles.errorCard}><Value style={styles.errorTitle}>Something went wrong</Value><Text style={styles.muted}>{p.error}</Text>
              <Button title="Try Again" variant="outline" onPress={p.onRetry} /></Card>
          ) : null}
          <View style={styles.host}>{(p.loading || !p.ready) && !p.error ? <Loading /> : null}{p.children}</View>
          {isPay && p.mode === 'bank' && p.paySession?.achTerms ? (
            <Card style={styles.consentCard}>
              <Text style={styles.terms}>{p.paySession.achTerms.text}</Text>
              <Pressable onPress={() => p.onConsentChange(!p.consent)} style={styles.consentRow} accessibilityRole="checkbox" accessibilityState={{ checked: p.consent }}>
                <View style={[styles.checkbox, p.consent && styles.checkboxOn]}>{p.consent ? <Text style={styles.check}>✓</Text> : null}</View>
                <Text style={styles.consentText}>I have read the authorization above and authorize this one-time debit from my bank account.</Text>
              </Pressable>
            </Card>
          ) : null}
          {NORTH_SANDBOX_TEST_CARDS.length ? (
            <Card><Value style={styles.title}>Sandbox test cards</Value>
              {NORTH_SANDBOX_TEST_CARDS.map((c) => <Text key={c.number} style={styles.muted}>{c.brand}: {c.number} — {c.result}</Text>)}
              {NORTH_SANDBOX_TEST_DETAILS.map((d) => <Text key={d} style={styles.muted}>{d}</Text>)}
            </Card>
          ) : null}
        </>
      )}

      <View style={styles.footer}>
        {p.done ? (
          <Button title="Done" onPress={p.onDone} style={styles.grow} />
        ) : (
          <>
            <Button title="Cancel" variant="outline" onPress={p.onCancel} disabled={p.submitting} />
            <Button title={p.submitting ? 'Processing…' : submitTitle} onPress={p.onSubmit} loading={p.submitting} disabled={!p.canSubmit || !p.ready} style={styles.grow} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center' },
  tabActive: { borderColor: colors.primary, backgroundColor: '#EAF8F5' },
  tabText: { fontWeight: '700', color: colors.textMuted },
  tabTextActive: { color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  due: { fontWeight: '800' },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  muted: { color: colors.textMuted, marginBottom: 4 },
  host: { minHeight: 320, borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, padding: 8 },
  consentCard: { borderWidth: 1, borderColor: '#F0E3C4', backgroundColor: '#FDF8EC' },
  terms: { fontSize: 13, color: '#4A4A4A', marginBottom: 10 },
  consentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxOn: { backgroundColor: colors.primary },
  check: { color: '#fff', fontWeight: '800' },
  consentText: { flex: 1, fontSize: 14 },
  success: { borderWidth: 1, borderColor: colors.primary, alignItems: 'center', gap: 4, paddingVertical: 24 },
  successTitle: { fontSize: 16, fontWeight: '800', color: colors.primary },
  amount: { fontSize: 30, fontWeight: '800', marginVertical: 6 },
  errorCard: { borderWidth: 1, borderColor: colors.danger },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 4 },
  footer: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
