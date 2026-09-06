import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { WebViewMessageEvent } from 'react-native-webview';
import { FieldsCheckoutLayout } from '../../src/components/FieldsCheckoutLayout';
import { useFieldsCheckout } from '../../src/lib/useFieldsCheckout';
import {
  FIELDS_SUBMIT_INJECTION,
  fieldsHostPageUrl,
  fieldsMountInjection,
  parseFieldsWebViewMessage,
  type FieldsFlow,
} from '../../src/lib/northFieldsCheckout';
import { API_URL } from '../../src/lib/config';
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

const HOST_PAGE_URL = fieldsHostPageUrl(API_URL);

export default function FieldsCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; invoiceId?: string; customerId?: string }>();
  const flow: FieldsFlow = params.flow === 'store' ? 'store' : 'pay';
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const c = useFieldsCheckout({ flow, invoiceId, customerId });
  const [ready, setReady] = useState(false);
  // North's hosted fields stack vertically on phones and the iframe cannot
  // resize itself, so give it room; the surrounding screen scrolls instead.
  const { width } = useWindowDimensions();
  const webViewHeight = width < 640 ? 820 : 560;
  const webViewRef = useRef<import('react-native-webview').WebView | null>(null);

  useEffect(() => {
    setReady(false);
  }, [c.sessionKey]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseFieldsWebViewMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'host-ready') {
      // The host page (served from our domain) has loaded; hand it the session
      // token so it can mount North's fields.
      if (c.session) webViewRef.current?.injectJavaScript(fieldsMountInjection(c.session.sessionToken));
      return;
    }
    if (message.type === 'fields-ready') setReady(true);
    if (message.type === 'fields-error') { c.setSubmitting(false); c.setError(message.message); }
    if (message.type === 'fields-result') void c.confirm(message.result);
  };

  const onSubmit = () => {
    if (!c.canSubmit || !ready) return;
    c.setSubmitting(true);
    webViewRef.current?.injectJavaScript(FIELDS_SUBMIT_INJECTION);
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
        needsVerification={c.needsVerification}
        onSubmit={onSubmit} onCancel={leave} onDone={leave} onRetry={() => void c.retry()}
      >
        {c.session ? (
          <WebViewComponent
            key={c.sessionKey}
            ref={webViewRef}
            source={{ uri: HOST_PAGE_URL }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => <Loading />}
            onMessage={onMessage}
            scrollEnabled={false}
            style={[styles.webview, { height: webViewHeight }]}
          />
        ) : null}
      </FieldsCheckoutLayout>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  webview: { backgroundColor: '#fff' },
  muted: { color: colors.textMuted, marginBottom: 6 },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 6 },
});
