import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { WebViewMessageEvent } from 'react-native-webview';
import { FieldsCheckoutLayout } from '../../src/components/FieldsCheckoutLayout';
import { useFieldsCheckout } from '../../src/lib/useFieldsCheckout';
import { buildFieldsWebViewHtml, parseFieldsWebViewMessage, type FieldsFlow } from '../../src/lib/northFieldsCheckout';
import { Button, Card, Loading, Value } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';

// react-native-webview needs the RNCWebView native module; load lazily so a
// stale binary shows a message instead of crashing the route tree.
let WebViewComponent: typeof import('react-native-webview').WebView | null = null;
let webViewLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebViewComponent = (require('react-native-webview') as typeof import('react-native-webview')).WebView;
} catch (e) {
  webViewLoadError = (e as Error).message;
}

export default function FieldsCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; invoiceId?: string; customerId?: string }>();
  const flow: FieldsFlow = params.flow === 'store' ? 'store' : 'pay';
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const c = useFieldsCheckout({ flow, invoiceId, customerId });
  const [ready, setReady] = useState(false);
  const webViewRef = useRef<import('react-native-webview').WebView | null>(null);

  const html = useMemo(() => (c.session ? buildFieldsWebViewHtml(c.session.sessionToken, c.session.scriptUrl) : ''), [c.session]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseFieldsWebViewMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'fields-ready') setReady(true);
    if (message.type === 'fields-error') { c.setSubmitting(false); c.setError(message.message); }
    if (message.type === 'fields-result') void c.confirm(message.result);
  };

  const onSubmit = () => {
    if (!c.canSubmit || !ready) return;
    c.setSubmitting(true);
    webViewRef.current?.injectJavaScript('window.__sfSubmit && window.__sfSubmit(); true;');
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (invoiceId) router.replace(`/invoice/${invoiceId}`);
    else if (customerId) router.replace({ pathname: '/customer/[id]', params: { id: customerId, tab: 'Payment Methods' } });
    else router.replace('/');
  };

  if (!WebViewComponent) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Secure Checkout' }} />
        <Card>
          <Value style={styles.errorTitle}>Payment form unavailable in this build</Value>
          <Text style={styles.muted}>This app build is missing the WebView component required for North Embedded Checkout. Rebuild the app (pod install + native rebuild).</Text>
          {webViewLoadError ? <Text style={styles.muted}>{webViewLoadError}</Text> : null}
          <Button title="Back" variant="outline" onPress={leave} />
        </Card>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: flow === 'pay' ? 'Secure Checkout' : 'Save Payment Method' }} />
      <FieldsCheckoutLayout
        flow={flow} mode={c.mode} onModeChange={c.setMode} paySession={c.paySession}
        consent={c.consent} onConsentChange={c.setConsent}
        ready={ready} loading={c.loading} error={c.error} submitting={c.submitting} canSubmit={c.canSubmit} done={c.done}
        onSubmit={onSubmit} onCancel={leave} onDone={leave} onRetry={() => { setReady(false); void c.startSession(); }}
      >
        {c.session ? (
          <WebViewComponent
            key={c.sessionKey}
            ref={webViewRef}
            source={{ html, baseUrl: 'https://checkout.north.com' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => <Loading />}
            onMessage={onMessage}
            style={styles.webview}
          />
        ) : null}
      </FieldsCheckoutLayout>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  webview: { height: 320, backgroundColor: '#fff' },
  muted: { color: colors.textMuted, marginBottom: 6 },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 6 },
});
