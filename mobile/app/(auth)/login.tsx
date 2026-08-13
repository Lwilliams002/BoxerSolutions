import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useAuth } from '../../src/lib/authStore';
import { Button, ErrorText } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';

export default function LoginScreen() {
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
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
        <Button
          title="Sign In"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
        />

        <Text style={styles.tagline}>Boxer Solutions Pest Control</Text>
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
    width: 170,
    height: 170,
    marginBottom: 18,
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
    padding: 28,
    paddingBottom: 48,
  },
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
});

