import React, { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FieldsCheckoutLayout } from '../../src/components/FieldsCheckoutLayout';
import { useFieldsCheckout } from '../../src/lib/useFieldsCheckout';
import { ensureCheckoutScript, mountFields, submitFields, type FieldsFlow } from '../../src/lib/northFieldsCheckout';

const HOST_ID = 'north-fields-root';

export default function FieldsCheckoutWebScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; invoiceId?: string; customerId?: string }>();
  const flow: FieldsFlow = params.flow === 'store' ? 'store' : 'pay';
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const c = useFieldsCheckout({ flow, invoiceId, customerId });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!c.session) { setReady(false); return; }
    let disposed = false;
    setReady(false);
    ensureCheckoutScript(c.session.scriptUrl)
      .then(() => (disposed ? undefined : mountFields(c.session!.sessionToken, HOST_ID)))
      .then(() => { if (!disposed) setReady(true); })
      .catch((e) => { if (!disposed) c.setError(e instanceof Error ? e.message : 'Unable to open the payment form.'); });
    return () => {
      disposed = true;
      const host = document.getElementById(HOST_ID);
      if (host) host.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.sessionKey]);

  const onSubmit = async () => {
    if (!c.canSubmit || !ready) return;
    c.setSubmitting(true);
    try {
      const result = await submitFields();
      await c.confirm(result);
    } catch (e) {
      c.setSubmitting(false);
      c.setError(e instanceof Error ? e.message : 'The payment could not be submitted.');
    }
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (invoiceId) router.replace(`/invoice/${invoiceId}`);
    else if (customerId) router.replace({ pathname: '/customer/[id]', params: { id: customerId, tab: 'Payment Methods' } });
    else router.replace('/');
  };

  return (
    <>
      <Stack.Screen options={{ title: flow === 'pay' ? 'Secure Checkout' : 'Save Payment Method' }} />
      <FieldsCheckoutLayout
        flow={flow} mode={c.mode} onModeChange={c.setMode} paySession={c.paySession}
        consent={c.consent} onConsentChange={c.setConsent}
        ready={ready} loading={c.loading} error={c.error} submitting={c.submitting} canSubmit={c.canSubmit} done={c.done}
        onSubmit={onSubmit} onCancel={leave} onDone={leave} onRetry={() => void c.startSession()}
      >
        <div id={HOST_ID} style={{ width: '100%', minHeight: 300, backgroundColor: '#fff' }} />
      </FieldsCheckoutLayout>
    </>
  );
}
