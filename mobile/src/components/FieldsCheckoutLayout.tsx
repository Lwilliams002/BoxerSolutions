// mobile/src/components/FieldsCheckoutLayout.tsx
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Value } from './ui';
import { colors, money } from '../lib/theme';
import {
  NORTH_SANDBOX_TEST_CARDS, NORTH_SANDBOX_TEST_DETAILS,
  type AchAccountType, type FieldsConfirmResult, type FieldsFlow, type FieldsNeedsConsent, type FieldsPaySession, type FieldsStoredMethod,
} from '../lib/northFieldsCheckout';

interface Props {
  flow: FieldsFlow;
  paySession: FieldsPaySession | null;
  /** North stored a bank account and is waiting for the customer's ACH authorization. */
  pendingConsent: FieldsNeedsConsent | null;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  achAccountType: AchAccountType;
  onAchAccountTypeChange: (value: AchAccountType) => void;
  canAuthorizeAch: boolean;
  onAuthorizeAch: () => void;
  ready: boolean;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  /** Submit succeeded but our confirm call failed — retry verification, never re-pay. */
  needsVerification?: boolean;
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
  const amountLabel = p.paySession ? money(p.paySession.amount) : '';
  const submitTitle = isPay ? `Pay ${amountLabel}`.trim() : 'Save Payment Method';
  const authorizeTitle = isPay ? `Authorize and pay ${amountLabel}`.trim() : 'Authorize and save';
  const pc = p.pendingConsent;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!isPay ? (
        <Card><Value style={styles.title}>Save a payment method on file (no charge)</Value>
          <Text style={styles.muted}>Choose card or bank account in the secure form. Details are tokenized by North; the number never touches our systems.</Text></Card>
      ) : null}

      {isPay && b ? (
        <Card>
          {[['Subtotal', b.subtotal], ['Taxes & fees', b.tax], ['Total', b.total]].map(([label, v]) => (
            <View key={String(label)} style={styles.row}><Text style={styles.muted}>{label}</Text><Text>{money(v as number)}</Text></View>
          ))}
          {b.previouslyPaid > 0 ? <View style={styles.row}><Text style={styles.muted}>Previously paid</Text><Text>-{money(b.previouslyPaid)}</Text></View> : null}
          <View style={styles.row}><Value style={styles.due}>Amount due today</Value><Value style={styles.due}>{money(b.amountDue)}</Value></View>
          {b.cashDiscountPercent && b.bankDiscount ? (
            <Text style={styles.surchargeNote}>Pay by bank account and save {b.cashDiscountPercent}%: {money(b.amountDueWithBank ?? b.amountDue - b.bankDiscount)} instead of {money(b.amountDue)}. Cards pay the listed price.</Text>
          ) : null}
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
              <Button title={p.needsVerification ? 'Retry verification' : 'Try Again'} variant="outline" onPress={p.onRetry} /></Card>
          ) : null}

          {pc ? (
            <Card style={styles.consentCard}>
              <Value style={styles.title}>Authorize bank account ••••{pc.last4 ?? '????'}</Value>
              <Text style={styles.muted}>
                {isPay
                  ? 'Your bank account has been securely stored. Confirm the account type and authorize the debit to complete this payment.'
                  : 'Your bank account has been securely stored. Confirm the account type and authorize future debits to keep it on file.'}
              </Text>
              <View style={styles.accountTypeRow}>
                <Text style={styles.accountTypeLabel}>Account type</Text>
                {(['checking', 'savings'] as const).map((t) => (
                  <Pressable key={t} onPress={() => p.onAchAccountTypeChange(t)} disabled={p.submitting}
                    accessibilityRole="radio" accessibilityState={{ selected: p.achAccountType === t }}
                    style={[styles.accountTypePill, p.achAccountType === t && styles.accountTypePillOn]}>
                    <Text style={[styles.accountTypeText, p.achAccountType === t && styles.accountTypeTextOn]}>{t === 'checking' ? 'Checking' : 'Savings'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.terms}>{pc.achTerms.text}</Text>
              <Pressable onPress={() => p.onConsentChange(!p.consent)} style={styles.consentRow} accessibilityRole="checkbox" accessibilityState={{ checked: p.consent }}>
                <View style={[styles.checkbox, p.consent && styles.checkboxOn]}>{p.consent ? <Text style={styles.check}>✓</Text> : null}</View>
                <Text style={styles.consentText}>I have read the ACH authorization above and authorize Boxer Solutions Pest Control to debit my bank account for this payment and, where I have recurring services, for future amounts due as described in those terms.</Text>
              </Pressable>
            </Card>
          ) : (
            <View style={styles.host}>{(p.loading || !p.ready) && !p.error ? <Loading /> : null}{p.children}</View>
          )}

          {!pc && NORTH_SANDBOX_TEST_CARDS.length ? (
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
        ) : pc ? (
          <>
            <Button title={p.needsVerification ? 'Close' : 'Cancel'} variant="outline" onPress={p.onCancel} disabled={p.submitting} />
            <Button title={p.submitting ? 'Processing…' : authorizeTitle} onPress={p.onAuthorizeAch} loading={p.submitting} disabled={!p.canAuthorizeAch} style={styles.grow} />
          </>
        ) : (
          <>
            <Button title={p.needsVerification ? 'Close' : 'Cancel'} variant="outline" onPress={p.onCancel} disabled={p.submitting} />
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
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  due: { fontWeight: '800' },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  muted: { color: colors.textMuted, marginBottom: 4 },
  host: { minHeight: 320, borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, padding: 8 },
  consentCard: { borderWidth: 1, borderColor: '#F0E3C4', backgroundColor: '#FDF8EC' },
  terms: { fontSize: 13, color: '#4A4A4A', marginBottom: 10 },
  consentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  accountTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  accountTypeLabel: { fontWeight: '700', marginRight: 4 },
  accountTypePill: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  accountTypePillOn: { borderColor: colors.primary, backgroundColor: '#EAF8F5' },
  accountTypeText: { color: colors.textMuted, fontWeight: '600' },
  accountTypeTextOn: { color: colors.text },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxOn: { backgroundColor: colors.primary },
  check: { color: '#fff', fontWeight: '800' },
  consentText: { flex: 1, fontSize: 14 },
  success: { borderWidth: 1, borderColor: colors.primary, alignItems: 'center', gap: 4, paddingVertical: 24 },
  successTitle: { fontSize: 16, fontWeight: '800', color: colors.primary },
  amount: { fontSize: 30, fontWeight: '800', marginVertical: 6 },
  surchargeNote: { fontSize: 12, color: '#0F7B3F', marginTop: 8, lineHeight: 16, fontWeight: '700' },
  errorCard: { borderWidth: 1, borderColor: colors.danger },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 4 },
  footer: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
