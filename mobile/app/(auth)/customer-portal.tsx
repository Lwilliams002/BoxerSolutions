import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ErrorText } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCustomerPortal } from '../../src/lib/customerPortalStore';
import { colors } from '../../src/lib/theme';

interface RequestCodeResult {
  sent: boolean;
  debugCode?: string;
}

interface TestPortalLoginResult {
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  isTestAccount: boolean;
  portalSessionToken: string;
  expiresIn: number;
}

export default function CustomerPortalScreen() {
  const router = useRouter();
  const setPortalSession = useCustomerPortal((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyTest, setBusyTest] = useState(false);

  const requestCode = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const data = await api<RequestCodeResult>('/auth/customer-portal/request-code', {
        method: 'POST',
        body: { email: email.trim().toLowerCase() },
      });
      const debugNote = data.debugCode ? ` (dev code: ${data.debugCode})` : '';
      setInfo(`If we found your account, a 6-digit code was sent${debugNote}`);
      router.push({
        pathname: '/(auth)/customer-portal-verify',
        params: { email: email.trim().toLowerCase() },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const continueAsTestCustomer = async () => {
    setError('');
    setInfo('');
    setBusyTest(true);
    try {
      const data = await api<TestPortalLoginResult>('/auth/customer-portal/test-login', {
        method: 'POST',
        body: { email: 'portal.test@antserve.dev' },
      });
      await setPortalSession({
        portalSessionToken: data.portalSessionToken,
        expiresIn: data.expiresIn,
      });
      router.replace({
        pathname: '/(auth)/customer-portal-home',
        params: { testMode: '1' },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyTest(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Image
          source={require('../../assets/logo-mark.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>CUSTOMER PORTAL</Text>
        <Text style={styles.brandSub}>BOXER SOLUTIONS</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in with Email</Text>
        <Text style={styles.subtitle}>Enter your email to receive a secure 6-digit login code.</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />

        {error ? <ErrorText message={error} /> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        <Button
          title="Send Login Code"
          onPress={requestCode}
          loading={busy}
          disabled={!email.includes('@')}
        />
        <Button
          title="Use Test Customer (No OTP)"
          variant="secondary"
          onPress={continueAsTestCustomer}
          loading={busyTest}
        />
        <Button
          title="Back to Staff Login"
          variant="outline"
          onPress={() => router.replace('/(auth)/login')}
        />
        <Button
          title="Privacy Policy"
          variant="secondary"
          onPress={() => router.push('/(auth)/privacy-policy')}
        />
        <Text style={styles.helper}>Test account: portal.test@antserve.dev</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    marginTop: 8,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 10,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  brandSub: {
    color: '#2DC4A2',
    marginTop: 4,
    letterSpacing: 2.5,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 18,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 14,
    fontSize: 16,
    marginBottom: 14,
    color: colors.text,
  },
  info: {
    color: colors.success,
    marginBottom: 10,
    textAlign: 'center',
  },
  helper: {
    marginTop: 8,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
  },
});
