import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { Button, Card, Loading, Value } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';
import {
  NORTH_SANDBOX_TEST_CARDS,
  NORTH_SANDBOX_TEST_DETAILS,
  formatEmbeddedCheckoutError,
} from '../../src/lib/northEmbeddedCheckout';

// Web variant: mounts North Embedded Checkout (Fields type, STORAGE) directly
// into the DOM — react-native-webview does not support the web platform.

// Kept in sync with the `declare global` block in
// src/lib/northFieldsCheckout.ts — TypeScript requires all augmentations of
// the same global interface member to share an identical type.
declare global {
  interface Window {
    checkout?: {
      mount?: (sessionToken: string, containerId: string) => Promise<void> | void;
      submit?: () => Promise<import('../../src/lib/northFieldsCheckout').FieldsSubmitResult>;
      onPaymentComplete?: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}

interface StorageSessionResponse {
  sessionToken: string;
  checkoutId: string;
  scriptUrl: string;
  customerId: string;
}

interface StorageConfirmResponse {
  id: string;
  brand: string;
  last4: string | null;
  duplicate?: boolean;
}

const HOST_ID = 'north-embedded-storage-root';
let checkoutScriptPromise: Promise<void> | null = null;
let checkoutScriptUrl = '';

function ensureCheckoutScript(scriptUrl: string) {
  if (typeof window === 'undefined') return Promise.resolve();
  if (typeof window.checkout?.mount === 'function' && typeof window.checkout?.onPaymentComplete === 'function' && checkoutScriptUrl === scriptUrl) {
    return Promise.resolve();
  }
  if (checkoutScriptPromise && checkoutScriptUrl === scriptUrl) return checkoutScriptPromise;

  checkoutScriptUrl = scriptUrl;
  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (window.checkout?.mount && window.checkout?.onPaymentComplete) {
        resolve();
      } else {
        reject(new Error('North checkout API did not load correctly.'));
      }
    };

    const existing = Array.from(document.scripts).find((script) => script.src === scriptUrl) as HTMLScriptElement | undefined;
    if (existing) {
      if (typeof window.checkout?.mount === 'function' && typeof window.checkout?.onPaymentComplete === 'function') {
        resolve();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load North checkout script.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('Unable to load North checkout script.'));
    document.head.appendChild(script);
  });

  return checkoutScriptPromise;
}

export default function SaveCardWebScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = typeof params.customerId === 'string' ? params.customerId : '';
  const [session, setSession] = useState<StorageSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [saved, setSaved] = useState<StorageConfirmResponse | null>(null);
  const confirmedRef = useRef(false);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (customerId) {
      router.replace({ pathname: '/customer/[id]', params: { id: customerId, tab: 'Payment Methods' } });
    } else {
      router.replace('/');
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!customerId) {
      setError('Customer ID is missing.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError(null);
        confirmedRef.current = false;
        const data = await api<StorageSessionResponse>('/payments/north/embedded/storage-session', {
          method: 'POST',
          body: { customerId },
        });
        if (!mounted) return;
        setSession(data);
      } catch (e) {
        if (!mounted) return;
        setError(formatEmbeddedCheckoutError(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [customerId]);

  const confirmStorage = async () => {
    if (!session || confirmedRef.current) return;
    confirmedRef.current = true;
    setSubmitting(true);
    try {
      const result = await api<StorageConfirmResponse>('/payments/north/embedded/storage-confirm', {
        method: 'POST',
        body: {
          customerId: session.customerId,
          sessionToken: session.sessionToken,
          setDefault: true,
        },
      });
      setSaved(result);
      void qc.invalidateQueries({ queryKey: ['paymentMethods', customerId] });
    } catch (e) {
      confirmedRef.current = false;
      const message = (e as Error).message || 'Unable to verify the stored card.';
      if (typeof window !== 'undefined') {
        window.alert(`Card could not be saved: ${message}`);
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Fields-type checkouts render inputs only — the integrator triggers
  // submission via checkout.submit(). onPaymentComplete fires afterwards.
  const submitCard = async () => {
    if (!checkoutReady || submitting || confirmedRef.current) return;
    setSubmitting(true);
    try {
      if (typeof window.checkout?.submit !== 'function') {
        throw new Error('North checkout API is not ready.');
      }
      await window.checkout.submit();
      // confirmStorage runs from onPaymentComplete; stop the spinner if the
      // completion callback has not fired shortly (validation errors keep the
      // form open without completing).
      setTimeout(() => {
        if (!confirmedRef.current) setSubmitting(false);
      }, 8_000);
    } catch (e) {
      setSubmitting(false);
      const message = e instanceof Error && e.message ? e.message : 'Card details could not be submitted.';
      if (typeof window !== 'undefined') window.alert(message);
    }
  };

  useEffect(() => {
    if (!session || typeof document === 'undefined') return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    setCheckoutReady(false);
    setError(null);
    const host = document.getElementById(HOST_ID);
    if (host) host.innerHTML = '';

    void ensureCheckoutScript(session.scriptUrl)
      .then(async () => {
        if (disposed) return;
        if (typeof window.checkout?.mount !== 'function' || typeof window.checkout?.onPaymentComplete !== 'function') {
          throw new Error('North checkout API did not load correctly.');
        }
        const maybeUnsubscribe = window.checkout.onPaymentComplete(() => {
          void confirmStorage();
        });
        unsubscribe = typeof maybeUnsubscribe === 'function' ? maybeUnsubscribe : undefined;
        await window.checkout.mount(session.sessionToken, HOST_ID);
        if (!disposed) setCheckoutReady(true);
      })
      .catch((e) => {
        if (!disposed) setError(e instanceof Error ? e.message : 'Unable to open the card form.');
      });

    return () => {
      disposed = true;
      unsubscribe?.();
      const currentHost = document.getElementById(HOST_ID);
      if (currentHost) currentHost.innerHTML = '';
    };
  }, [session]);

  const host = useMemo(
    () => <div id={HOST_ID} style={hostStyle} />,
    [],
  );

  if (loading) {
    return <Loading />;
  }

  if (error || !session) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Save Card' }} />
        <Card>
          <Value style={styles.errorTitle}>Unable to open the secure card form</Value>
          <Value>{error ?? 'Missing storage session.'}</Value>
          <Button title="Back" variant="outline" onPress={goBack} />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Save Card' }} />
      <Card style={styles.helpCard}>
        <Value style={styles.helpTitle}>Save a card on file (no charge)</Value>
        <Text style={styles.helpText}>
          The card is tokenized by North and stored as a secure token — the number never touches our systems.
        </Text>
        {NORTH_SANDBOX_TEST_CARDS.map((card) => (
          <Text key={card.number} style={styles.helpText}>
            {card.brand}: {card.number} — {card.result}
          </Text>
        ))}
        {NORTH_SANDBOX_TEST_DETAILS.map((detail) => (
          <Text key={detail} style={styles.helpText}>{detail}</Text>
        ))}
      </Card>
      {saved ? (
        <Card style={styles.receiptCard}>
          <Value style={styles.successTitle}>{saved.duplicate ? 'Card already on file' : 'Card saved'}</Value>
          <Value style={styles.receiptAmount}>{saved.brand}{saved.last4 ? ` ****${saved.last4}` : ''}</Value>
          <Text style={styles.helpText}>The card is stored on file and set as the default payment method.</Text>
        </Card>
      ) : (
        <View style={styles.webHostWrap}>
          {!checkoutReady ? <Loading /> : null}
          {host}
        </View>
      )}
      <View style={styles.footer}>
        {saved ? (
          <Button title="Done" onPress={goBack} style={styles.confirmBtn} />
        ) : (
          <>
            <Button title="Cancel" variant="outline" onPress={goBack} disabled={submitting} />
            <Button
              title={submitting ? 'Saving…' : 'Save Card'}
              variant="success"
              onPress={submitCard}
              loading={submitting}
              disabled={!checkoutReady || submitting}
              style={styles.confirmBtn}
            />
          </>
        )}
      </View>
    </View>
  );
}

const hostStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '720px',
  backgroundColor: '#FFFFFF',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
    gap: 12,
  },
  helpCard: {
    marginBottom: 0,
  },
  helpTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  helpText: {
    color: colors.textMuted,
    marginBottom: 4,
  },
  receiptCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    minHeight: 320,
  },
  receiptAmount: {
    fontSize: 24,
    fontWeight: '800',
    marginVertical: 8,
  },
  successTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
    marginBottom: 4,
  },
  webHostWrap: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 720,
    padding: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmBtn: {
    flex: 1,
  },
  errorTitle: {
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 6,
    color: colors.danger,
  },
});





