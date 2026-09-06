// mobile/src/lib/useFieldsCheckout.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import {
  describeFieldsFailure, formatEmbeddedCheckoutError,
  type AchAccountType, type FieldsConfirmResponse, type FieldsConfirmResult, type FieldsFlow, type FieldsNeedsConsent,
  type FieldsPaySession, type FieldsStorageSession, type FieldsStoredMethod, type FieldsStoreResponse, type FieldsSubmitResult,
} from './northFieldsCheckout';

/**
 * One STORAGE session per checkout. The customer picks card or bank inside
 * North's form; after submit the server tells us what it stored. A bank
 * account needs the customer's ACH authorization before anything is debited
 * or saved, so the server answers `needs_ach_consent` and we confirm the same
 * session again once they agree.
 */
export function useFieldsCheckout(params: { flow: FieldsFlow; invoiceId?: string; customerId?: string }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<FieldsPaySession | FieldsStorageSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingConsent, setPendingConsent] = useState<FieldsNeedsConsent | null>(null);
  const [consent, setConsent] = useState(false);
  // North requires checking|savings on every ACH token transaction and never reports it back.
  const [achAccountType, setAchAccountType] = useState<AchAccountType>('checking');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<FieldsConfirmResult | FieldsStoredMethod | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  // Set when checkout.submit() succeeded but our confirm call failed after the
  // token sale may have run. The session token stays valid, so the only safe
  // recovery is to verify that same session again — never to mint a new one.
  const [needsVerification, setNeedsVerification] = useState(false);
  const confirmingRef = useRef(false);
  const requestIdRef = useRef(0);
  const pendingResultRef = useRef<FieldsSubmitResult | null>(null);

  const startSession = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setSession(null);
    setPendingConsent(null);
    setConsent(false);
    setNeedsVerification(false);
    confirmingRef.current = false;
    pendingResultRef.current = null;
    try {
      if (params.flow === 'pay') {
        if (!params.invoiceId) throw new Error('Invoice ID is missing.');
        const data = await api<FieldsPaySession>('/payments/north/fields/session', { method: 'POST', body: { invoiceId: params.invoiceId } });
        if (requestIdRef.current !== requestId) return;
        setSession(data);
      } else {
        if (!params.customerId) throw new Error('Customer ID is missing.');
        const data = await api<FieldsStorageSession>('/payments/north/fields/storage-session', { method: 'POST', body: { customerId: params.customerId } });
        if (requestIdRef.current !== requestId) return;
        setSession(data);
      }
      if (requestIdRef.current !== requestId) return;
      setSessionKey((k) => k + 1);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setError(formatEmbeddedCheckoutError(e));
    } finally {
      if (requestIdRef.current !== requestId) return;
      setLoading(false);
    }
  }, [params.flow, params.invoiceId, params.customerId]);

  useEffect(() => { void startSession(); }, [startSession]);

  const postConfirm = async (withConsent: boolean) => {
    if (!session) return;
    const consentFields = withConsent ? { achConsent: true, achAccountType } : {};
    if (params.flow === 'pay') {
      const data = await api<FieldsConfirmResponse>('/payments/north/fields/confirm', {
        method: 'POST',
        body: { invoiceId: params.invoiceId, sessionToken: session.sessionToken, ...consentFields },
      });
      if (data.status === 'needs_ach_consent') { setPendingConsent(data); return; }
      setDone(data);
      void qc.invalidateQueries({ queryKey: ['invoice', params.invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoicePayments', params.invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    } else {
      const data = await api<FieldsStoreResponse>('/payments/north/fields/storage-confirm', {
        method: 'POST',
        body: { customerId: params.customerId, sessionToken: session.sessionToken, setDefault: true, ...consentFields },
      });
      if (data.status === 'needs_ach_consent') { setPendingConsent(data); return; }
      setDone(data);
    }
    void qc.invalidateQueries({ queryKey: ['paymentMethods'] });
    pendingResultRef.current = null;
    setPendingConsent(null);
    setNeedsVerification(false);
  };

  const confirm = async (result: FieldsSubmitResult) => {
    if (!session || confirmingRef.current) return;
    if (result.type !== 'success') {
      setSubmitting(false);
      setError(describeFieldsFailure(result));
      // A failed submit moved no money and spent the session — mount a fresh
      // one for the retry. This is the ONLY path allowed to start a new session
      // after a submit.
      void startSession();
      return;
    }
    pendingResultRef.current = result;
    confirmingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await postConfirm(false);
    } catch (e) {
      // Keep the session: the submit already went through, so retrying must
      // verify this same session rather than create another one.
      setNeedsVerification(true);
      setError((e as Error).message || 'Unable to verify the payment.');
    } finally {
      confirmingRef.current = false;
      setSubmitting(false);
    }
  };

  /** Bank account stored by North; the customer has now agreed to the ACH terms. */
  const authorizeAch = async () => {
    if (!session || !pendingConsent || !consent || confirmingRef.current) return;
    confirmingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await postConfirm(true);
    } catch (e) {
      setNeedsVerification(true);
      setError((e as Error).message || 'Unable to complete the bank payment.');
    } finally {
      confirmingRef.current = false;
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (needsVerification) {
      if (pendingConsent) { await authorizeAch(); return; }
      const pending = pendingResultRef.current;
      if (pending) { await confirm(pending); return; }
    }
    await startSession();
  };

  const paySession = params.flow === 'pay' ? (session as FieldsPaySession | null) : null;
  const canSubmit = !loading && !submitting && !done && !needsVerification && !pendingConsent && !!session;
  const canAuthorizeAch = !!pendingConsent && consent && !submitting && !done;

  return {
    session, paySession, loading, error, setError,
    pendingConsent, consent, setConsent, achAccountType, setAchAccountType, authorizeAch, canAuthorizeAch,
    submitting, setSubmitting, done, startSession, confirm, retry, needsVerification, canSubmit, sessionKey,
  };
}
