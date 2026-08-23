import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ErrorText } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCustomerPortal } from '../../src/lib/customerPortalStore';
import { colors } from '../../src/lib/theme';

interface VerifyCodeResult {
  customerId: string;
  email: string;
  cognitoRequired: boolean;
  portalSessionToken: string;
  expiresIn: number;
}

export default function CustomerPortalVerifyScreen() {
  const router = useRouter();
  const setPortalSession = useCustomerPortal((s) => s.setSession);
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = useMemo(() => (params.email ?? '').toString(), [params.email]);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setError('');
    setBusy(true);
    try {
      const data = await api<VerifyCodeResult>('/auth/customer-portal/verify-code', {
        method: 'POST',
        body: {
          email: email.trim().toLowerCase(),
          code: code.trim(),
        },
      });
      await setPortalSession({
        portalSessionToken: data.portalSessionToken,
        expiresIn: data.expiresIn,
      });
      router.replace('/(auth)/customer-portal-home');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>Use the 6-digit code sent to your email.</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="6-digit code"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
          maxLength={6}
        />

        {error ? <ErrorText message={error} /> : null}

        <Button
          title="Verify and Continue"
          onPress={verify}
          loading={busy}
          disabled={!email.includes('@') || code.trim().length !== 6}
        />
        <Button
          title="Back"
          variant="outline"
          onPress={() => router.replace('/(auth)/customer-portal')}
        />
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
    width: 112,
    height: 112,
    marginBottom: 10,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1.2,
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
});
