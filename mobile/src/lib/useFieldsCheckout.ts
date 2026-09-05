// mobile/src/lib/useFieldsCheckout.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import {
  describeFieldsFailure, formatEmbeddedCheckoutError,
  type FieldsConfirmResult, type FieldsFlow, type FieldsPayMode, type FieldsPaySession,
  type FieldsStorageSession, type FieldsStoredMethod, type FieldsSubmitResult,
} from './northFieldsCheckout';

export function useFieldsCheckout(params: { flow: FieldsFlow; invoiceId?: string; customerId?: string }) {
  const qc = useQueryClient();
  const [mode, setModeState] = useState<FieldsPayMode>('card');
  const [session, setSession] = useState<FieldsPaySession | FieldsStorageSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<FieldsConfirmResult | FieldsStoredMethod | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  // Set when checkout.submit() succeeded (bank mode has already debited the
  // account at that point) but our confirm call failed. The session token stays
  // valid, so the only safe recovery is to verify that same session again —
  // never to mint a new one, which would take a second payment.
  const [needsVerification, setNeedsVerification] = useState(false);
  const confirmingRef = useRef(false);
  const requestIdRef = useRef(0);
  const pendingResultRef = useRef<FieldsSubmitResult | null>(null);

  const startSession = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setSession(null);
    setConsent(false);
    setNeedsVerification(false);
    confirmingRef.current = false;
    pendingResultRef.current = null;
    try {
      if (params.flow === 'pay') {
        if (!params.invoiceId) throw new Error('Invoice ID is missing.');
        const data = await api<FieldsPaySession>('/payments/north/fields/session', { method: 'POST', body: { invoiceId: params.invoiceId, mode } });
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
  }, [params.flow, params.invoiceId, params.customerId, mode]);

  useEffect(() => { void startSession(); }, [startSession]);

  const setMode = (next: FieldsPayMode) => {
    if (submitting || done || needsVerification) return;
    setModeState(next);
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
      if (params.flow === 'pay') {
        const data = await api<FieldsConfirmResult>('/payments/north/fields/confirm', {
          method: 'POST',
          body: { invoiceId: params.invoiceId, mode, sessionToken: session.sessionToken, achConsent: mode === 'bank' ? consent : undefined },
        });
        setDone(data);
        void qc.invalidateQueries({ queryKey: ['invoice', params.invoiceId] });
        void qc.invalidateQueries({ queryKey: ['invoicePayments', params.invoiceId] });
        void qc.invalidateQueries({ queryKey: ['invoices'] });
      } else {
        const data = await api<FieldsStoredMethod>('/payments/north/fields/storage-confirm', {
          method: 'POST',
          body: { customerId: params.customerId, sessionToken: session.sessionToken, setDefault: true },
        });
        setDone(data);
      }
      void qc.invalidateQueries({ queryKey: ['paymentMethods'] });
      pendingResultRef.current = null;
      setNeedsVerification(false);
    } catch (e) {
      confirmingRef.current = false;
      // Keep the session: the submit already went through, so retrying must
      // verify this same session rather than create another one.
      setNeedsVerification(true);
      setError((e as Error).message || 'Unable to verify the payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (needsVerification) {
      const pending = pendingResultRef.current;
      if (pending) {
        await confirm(pending);
        return;
      }
    }
    await startSession();
  };

  const paySession = params.flow === 'pay' ? (session as FieldsPaySession | null) : null;
  const canSubmit = !loading && !submitting && !done && !needsVerification && !!session && (mode !== 'bank' || consent);

  return { mode, setMode, session, paySession, loading, error, setError, consent, setConsent, submitting, setSubmitting, done, startSession, confirm, retry, needsVerification, canSubmit, sessionKey };
}
