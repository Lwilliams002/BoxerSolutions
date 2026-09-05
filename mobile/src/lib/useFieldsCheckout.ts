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
  const confirmingRef = useRef(false);
  const requestIdRef = useRef(0);

  const startSession = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setSession(null);
    setConsent(false);
    confirmingRef.current = false;
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
    if (submitting || done) return;
    setModeState(next);
  };

  const confirm = async (result: FieldsSubmitResult) => {
    if (!session || confirmingRef.current) return;
    if (result.type !== 'success') {
      setSubmitting(false);
      setError(describeFieldsFailure(result));
      // A submitted session is spent — mount a fresh one for the retry.
      void startSession();
      return;
    }
    confirmingRef.current = true;
    setSubmitting(true);
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
    } catch (e) {
      confirmingRef.current = false;
      setError((e as Error).message || 'Unable to verify the payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const paySession = params.flow === 'pay' ? (session as FieldsPaySession | null) : null;
  const canSubmit = !loading && !submitting && !done && !!session && (mode !== 'bank' || consent);

  return { mode, setMode, session, paySession, loading, error, setError, consent, setConsent, submitting, setSubmitting, done, startSession, confirm, canSubmit, sessionKey };
}
