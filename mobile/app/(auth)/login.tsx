import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/authStore';
import { Button, ErrorText } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';
import { API_URL } from '../../src/lib/config';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const submit = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestResetCode = async () => {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setError('');
    setNotice('');
    setResetBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message ?? 'Could not request reset code');
      setShowReset(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };

  const submitReset = async () => {
    if (!email.trim() || !resetCode.trim() || !newPassword) {
      setError('Enter email, reset code, and a new password.');
      return;
    }
    setError('');
    setNotice('');
    setResetBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: resetCode.trim(),
          newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message ?? 'Could not reset password');
      setResetCode('');
      setNewPassword('');
      setShowReset(false);
      setNotice('Password updated. Sign in with your new password.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Brand header — dark background matching the logo */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/logo-mark.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>BOXER SOLUTIONS</Text>
        <View style={styles.brandRule} />
        <Text style={styles.brandSub}>PEST CONTROL</Text>
      </View>

      {/* Login card */}
      <View style={styles.card}>
        <Text style={styles.welcome}>Sign in to your account</Text>

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
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {error ? <ErrorText message={error} /> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Button
          title="Sign In"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
        />
        <TouchableOpacity onPress={requestResetCode} disabled={resetBusy || !email} style={styles.linkRow}>
          <Text style={[styles.link, !email && { opacity: 0.5 }]}>{resetBusy ? 'Sending reset code…' : 'Forgot password?'}</Text>
        </TouchableOpacity>
        <Button
          title="Forgot Password"
          variant="secondary"
          onPress={requestResetCode}
          loading={resetBusy}
          style={{ display: 'none' }}
          disabled={!email}
        />
        {showReset ? (
          <View style={styles.resetBox}>
            <TextInput
              style={styles.input}
              placeholder="Reset Code"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              value={resetCode}
              onChangeText={setResetCode}
            />
            <TextInput
              style={styles.input}
              placeholder="New Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <Button
              title="Reset Password"
              onPress={submitReset}
              loading={resetBusy}
              disabled={!resetCode || !newPassword}
            />
          </View>
        ) : null}
        <View style={styles.dividerRow}><View style={styles.dividerLine} /><Text style={styles.dividerText}>Customers</Text><View style={styles.dividerLine} /></View>
        <View style={styles.pairRow}>
          <Button
            title="Customer Portal"
            variant="outline"
            onPress={() => router.push('/(auth)/customer-portal')}
            style={{ flex: 1, marginRight: 6 }}
          />
          <Button
            title="Request Service"
            variant="secondary"
            onPress={() => router.push('/(auth)/request-service-public')}
            style={{ flex: 1, marginLeft: 6 }}
          />
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.tagline}>Boxer Solutions Pest Control</Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/privacy-policy')}><Text style={styles.link}>Privacy Policy</Text></TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0D0D',
    paddingTop: 40,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 14,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
  },
  brandRule: {
    width: 56,
    height: 3,
    backgroundColor: '#2DC4A2',
    borderRadius: 2,
    marginVertical: 10,
  },
  brandSub: {
    color: '#2DC4A2',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 6,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 34,
  },
  linkRow: { alignSelf: 'flex-end', marginTop: -2, marginBottom: 10 },
  link: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: 10, fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  pairRow: { flexDirection: 'row' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  welcome: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 20,
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
  tagline: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 20,
    letterSpacing: 0.5,
  },
  resetBox: {
    marginTop: 10,
    marginBottom: 4,
  },
  notice: {
    color: '#047857',
    marginBottom: 10,
    textAlign: 'center',
    fontWeight: '600',
  },
});
