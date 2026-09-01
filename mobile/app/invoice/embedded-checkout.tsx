import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { api } from '../../src/lib/api';
import { Button, Card, Loading, Value } from '../../src/components/ui';
import { colors, money } from '../../src/lib/theme';
import {
  CheckoutMessage,
  ConfirmResponse,
  NORTH_SANDBOX_TEST_CARDS,
  NORTH_SANDBOX_TEST_DETAILS,
  SessionResponse,
  formatEmbeddedCheckoutError,
} from '../../src/lib/northEmbeddedCheckout';

function buildCheckoutHtml(sessionToken: string, scriptUrl: string) {
  const safeToken = JSON.stringify(sessionToken);
  const safeScriptUrl = JSON.stringify(scriptUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #f5f7f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #container { min-height: 100vh; padding: 16px; box-sizing: border-box; }
      #checkout-root { width: 100%; min-height: 640px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      #status { color: #5f6b68; font-size: 14px; text-align: center; margin: 16px 0 8px; }
      #error { color: #c0352b; font-size: 14px; text-align: center; margin: 16px 0; display: none; }
    </style>
  </head>
  <body>
    <div id="container">
      <div id="status">Loading secure payment form…</div>
      <div id="error"></div>
      <div id="checkout-root"></div>
    </div>
    <script>
      (function() {
        var sessionToken = ${safeToken};
        var scriptUrl = ${safeScriptUrl};
        var statusEl = document.getElementById('status');
        var errorEl = document.getElementById('error');
        function send(message) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(message));
          }
        }
        function showError(message) {
          if (statusEl) statusEl.style.display = 'none';
          if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = message;
          }
          send({ type: 'checkout-error', message: message });
        }
        function onLoaded() {
          if (statusEl) statusEl.style.display = 'none';
          send({ type: 'checkout-loaded' });
        }
        var script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = function() {
          try {
            if (!window.checkout || typeof window.checkout.mount !== 'function' || typeof window.checkout.onPaymentComplete !== 'function') {
              showError('North checkout API did not load correctly.');
              return;
            }
            window.checkout.onPaymentComplete(function(payload) {
              send({ type: 'payment-complete', payload: payload || {} });
            });
            Promise.resolve(window.checkout.mount(sessionToken, 'checkout-root'))
              .then(onLoaded)
              .catch(function(err) { showError(err && err.message ? err.message : 'Unable to open checkout.'); });
          } catch (err) {
            showError(err && err.message ? err.message : 'Unable to initialize checkout.');
          }
        };
        script.onerror = function() {
          showError('Unable to load North checkout script.');
        };
        document.head.appendChild(script);
      })();
    </script>
  </body>
</html>`;
}

export default function EmbeddedCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invoiceId?: string }>();
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : '';
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmResponse | null>(null);
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

  const html = useMemo(() => {
    if (!session) return '';
    return buildCheckoutHtml(session.sessionToken, session.scriptUrl);
  }, [session]);

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
      setConfirmed(result);
      Alert.alert(
        result.duplicate ? 'Payment already recorded' : 'Payment approved',
        `${money(result.amount)} ${result.duplicate ? 'was already captured for this invoice.' : 'was successfully captured.'}`,
        [{ text: 'Done', onPress: () => router.replace(`/invoice/${session.invoiceId}`) }],
      );
    } catch (e) {
      confirmedRef.current = false;
      Alert.alert('Payment confirmation failed', (e as Error).message || 'Unable to verify the payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as CheckoutMessage;
      if (data.type === 'checkout-error') {
        setError(data.message ?? 'Unable to open checkout.');
        return;
      }
      if (data.type === 'payment-complete') {
        void confirmPayment();
      }
    } catch {
      setError('Received an unexpected response from the checkout form.');
    }
  };

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
      {confirmed ? (
        <View style={styles.receiptCard}>
          <Value style={styles.receiptTitle}>
            {confirmed.duplicate ? 'Payment already recorded' : 'Payment approved'}
          </Value>
          <Value style={styles.receiptAmount}>{money(confirmed.amount)}</Value>
          <Text style={styles.helpText}>Transaction: {confirmed.transactionId}</Text>
          <Text style={styles.helpText}>A receipt has been generated and attached to the invoice.</Text>
        </View>
      ) : (
        <View style={styles.webviewWrap}>
          <WebView
            source={{ html, baseUrl: 'https://checkout.north.com' }}
            originWhitelist={['*']}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => <Loading />}
            style={styles.webview}
          />
        </View>
      )}
      <View style={styles.footer}>
        {confirmed ? (
          <Button
            title="View Invoice"
            onPress={() => router.replace(`/invoice/${session.invoiceId}`)}
            style={styles.confirmBtn}
          />
        ) : (
          <>
            <Button title="Cancel" variant="outline" onPress={() => router.back()} disabled={submitting} />
            <Button title="Confirming…" onPress={() => undefined} loading={submitting} disabled={!submitting} style={styles.confirmBtn} />
          </>
        )}
      </View>
    </View>
  );
}

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
  webviewWrap: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
  },
  receiptCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    padding: 20,
  },
  receiptTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  receiptAmount: {
    fontSize: 32,
    fontWeight: '800',
    marginVertical: 8,
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
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


