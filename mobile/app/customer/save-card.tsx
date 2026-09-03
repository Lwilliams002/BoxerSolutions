import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { WebViewMessageEvent } from 'react-native-webview';
import { api } from '../../src/lib/api';
import { Button, Card, Loading, Value } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';
import {
  CheckoutMessage,
  NORTH_SANDBOX_TEST_CARDS,
  NORTH_SANDBOX_TEST_DETAILS,
  formatEmbeddedCheckoutError,
} from '../../src/lib/northEmbeddedCheckout';

// Saves a card on file via North Embedded Checkout STORAGE (BRIC token) —
// card data never touches our servers.

let WebViewComponent: typeof import('react-native-webview').WebView | null = null;
let webViewLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebViewComponent = (require('react-native-webview') as typeof import('react-native-webview')).WebView;
} catch (e) {
  webViewLoadError = (e as Error).message;
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
      <div id="status">Loading secure card form…</div>
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
              .catch(function(err) { showError(err && err.message ? err.message : 'Unable to open the card form.'); });
          } catch (err) {
            showError(err && err.message ? err.message : 'Unable to initialize the card form.');
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

export default function SaveCardScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = typeof params.customerId === 'string' ? params.customerId : '';
  const [session, setSession] = useState<StorageSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const html = useMemo(() => {
    if (!session) return '';
    return buildCheckoutHtml(session.sessionToken, session.scriptUrl);
  }, [session]);

  const confirmStorage = async () => {
    if (!session || confirmedRef.current || submitting) return;
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
      Alert.alert(
        result.duplicate ? 'Card already on file' : 'Card saved',
        `${result.brand}${result.last4 ? ` ****${result.last4}` : ''} is ${result.duplicate ? 'already' : 'now'} stored on file for future charges.`,
        [{ text: 'Done', onPress: () => goBack() }],
      );
    } catch (e) {
      confirmedRef.current = false;
      Alert.alert('Card could not be saved', (e as Error).message || 'Unable to verify the stored card.');
    } finally {
      setSubmitting(false);
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as CheckoutMessage;
      if (data.type === 'checkout-error') {
        setError(data.message ?? 'Unable to open the card form.');
        return;
      }
      if (data.type === 'payment-complete') {
        void confirmStorage();
      }
    } catch {
      setError('Received an unexpected response from the card form.');
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (!WebViewComponent) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Save Card' }} />
        <Card>
          <Value style={styles.errorTitle}>Card form unavailable in this build</Value>
          <Value>
            This app build is missing the WebView component required for North Embedded Checkout.
            Rebuild the app (pod install + native rebuild).
          </Value>
          {webViewLoadError ? <Text style={styles.helpText}>{webViewLoadError}</Text> : null}
          <Button title="Back" variant="outline" onPress={goBack} />
        </Card>
      </View>
    );
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
        <View style={styles.receiptCard}>
          <Value style={styles.receiptTitle}>{saved.duplicate ? 'Card already on file' : 'Card saved'}</Value>
          <Value style={styles.receiptAmount}>{saved.brand}{saved.last4 ? ` ****${saved.last4}` : ''}</Value>
        </View>
      ) : (
        <View style={styles.webviewWrap}>
          <WebViewComponent
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
        {saved ? (
          <Button title="Done" onPress={goBack} style={styles.confirmBtn} />
        ) : (
          <>
            <Button title="Cancel" variant="outline" onPress={goBack} disabled={submitting} />
            <Button title="Saving…" onPress={() => undefined} loading={submitting} disabled={!submitting} style={styles.confirmBtn} />
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
    fontSize: 24,
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


