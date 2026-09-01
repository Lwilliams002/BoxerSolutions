import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { Button, Card, Loading, Value } from '../../src/components/ui';
import { colors, money } from '../../src/lib/theme';
import {
  ConfirmResponse,
  NORTH_SANDBOX_TEST_CARDS,
  NORTH_SANDBOX_TEST_DETAILS,
  SessionResponse,
  formatEmbeddedCheckoutError,
} from '../../src/lib/northEmbeddedCheckout';

declare global {
  interface Window {
    checkout?: {
      mount?: (sessionToken: string, hostId: string) => Promise<void> | void;
      onPaymentComplete?: (callback: (payload: Record<string, unknown>) => void) => (() => void) | void;
    };
  }
}

const HOST_ID = 'north-embedded-checkout-root';
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

export default function EmbeddedCheckoutWebScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invoiceId?: string }>();
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : '';
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const confirmedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    if (!invoiceId) {
      setError('Invoice ID is missing.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError(null);
        confirmedRef.current = false;
        const data = await api<SessionResponse>('/payments/north/embedded/session', {
          method: 'POST',
          body: { invoiceId },
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
  }, [invoiceId]);

  const confirmPayment = async () => {
    if (!session || confirmedRef.current || submitting) return;
    confirmedRef.current = true;
    setSubmitting(true);
    try {
      const result = await api<ConfirmResponse>('/payments/north/embedded/confirm', {
        method: 'POST',
        body: {
          invoiceId: session.invoiceId,
          sessionToken: session.sessionToken,
        },
      });
      // Alert.alert is a no-op on web — use window.alert and navigate directly.
      if (typeof window !== 'undefined') {
        window.alert(
          `${result.duplicate ? 'Payment already recorded' : 'Payment approved'}: ${money(result.amount)} ${result.duplicate ? 'was already captured for this invoice.' : 'was successfully captured.'}`,
        );
      }
      router.replace(`/invoice/${session.invoiceId}`);
    } catch (e) {
      confirmedRef.current = false;
      const message = (e as Error).message || 'Unable to verify the payment.';
      if (typeof window !== 'undefined') {
        window.alert(`Payment confirmation failed: ${message}`);
      }
      setError(message);
    } finally {
      setSubmitting(false);
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
          void confirmPayment();
        });
        unsubscribe = typeof maybeUnsubscribe === 'function' ? maybeUnsubscribe : undefined;
        await window.checkout.mount(session.sessionToken, HOST_ID);
        if (!disposed) setCheckoutReady(true);
      })
      .catch((e) => {
        if (!disposed) setError(e instanceof Error ? e.message : 'Unable to open checkout.');
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
        <Stack.Screen options={{ title: 'Embedded Checkout' }} />
        <Card>
          <Value style={styles.errorTitle}>Unable to start payment</Value>
          <Value>{error ?? 'Missing checkout session.'}</Value>
          <Button title="Back to Invoice" variant="outline" onPress={() => router.back()} />
        </Card>
        <Card style={styles.helpCard}>
          <Value style={styles.helpTitle}>Sandbox test cards</Value>
          {NORTH_SANDBOX_TEST_CARDS.map((card) => (
            <Text key={card.number} style={styles.helpText}>
              {card.brand}: {card.number} — {card.result}
            </Text>
          ))}
          {NORTH_SANDBOX_TEST_DETAILS.map((detail) => (
            <Text key={detail} style={styles.helpText}>{detail}</Text>
          ))}
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Embedded Checkout' }} />
      <Card style={styles.summaryCard}>
        <Value style={styles.summaryLabel}>Invoice Balance</Value>
        <Value style={styles.summaryAmount}>{money(session.amount)}</Value>
      </Card>
      <Card style={styles.helpCard}>
        <Value style={styles.helpTitle}>Sandbox test cards</Value>
        {NORTH_SANDBOX_TEST_CARDS.map((card) => (
          <Text key={card.number} style={styles.helpText}>
            {card.brand}: {card.number} — {card.result}
          </Text>
        ))}
        {NORTH_SANDBOX_TEST_DETAILS.map((detail) => (
          <Text key={detail} style={styles.helpText}>{detail}</Text>
        ))}
      </Card>
      <View style={styles.webHostWrap}>
        {!checkoutReady ? <Loading /> : null}
        {host}
      </View>
      <View style={styles.footer}>
        <Button title="Cancel" variant="outline" onPress={() => router.back()} disabled={submitting} />
        <Button title="Confirming…" onPress={() => undefined} loading={submitting} disabled={!submitting} style={styles.confirmBtn} />
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
  summaryCard: {
    marginBottom: 0,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryAmount: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 6,
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


