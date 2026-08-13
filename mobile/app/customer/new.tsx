import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { colors } from '../../src/lib/theme';
import { Button, SectionTitle, Row, ErrorText } from '../../src/components/ui';

function Field({
  label,
  value,
  onChange,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'words'}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

export default function NewCustomerScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [commercial, setCommercial] = useState(false);
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('TX');
  const [postal, setPostal] = useState('');
  const [sameBilling, setSameBilling] = useState(true);
  const [billing1, setBilling1] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('TX');
  const [billingPostal, setBillingPostal] = useState('');

  const save = async () => {
    setError('');
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    if (!address1.trim() || !city.trim() || !postal.trim()) {
      setError('Service address, city and postal code are required.');
      return;
    }
    const payload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      customerType: commercial ? 'commercial' : 'residential',
      status: 'active',
      autopayEnabled: false,
      billingAddressLine1: (sameBilling ? address1 : billing1).trim() || null,
      billingCity: (sameBilling ? city : billingCity).trim() || null,
      billingState: (sameBilling ? state : billingState).trim() || null,
      billingPostalCode: (sameBilling ? postal : billingPostal).trim() || null,
      serviceLocation: {
        label: 'Primary',
        addressLine1: address1.trim(),
        city: city.trim(),
        state: state.trim(),
        postalCode: postal.trim(),
      },
    };
    router.push({ pathname: '/customer/agreement', params: { payload: JSON.stringify(payload) } });
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <SectionTitle>Contact</SectionTitle>
      <Field label="First Name *" value={firstName} onChange={setFirstName} />
      <Field label="Last Name *" value={lastName} onChange={setLastName} />
      <Field label="Company" value={company} onChange={setCompany} />
      <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" />
      <Row style={styles.switchRow}>
        <Text style={styles.label}>Commercial customer</Text>
        <Switch value={commercial} onValueChange={setCommercial} />
      </Row>

      <SectionTitle>Service Address</SectionTitle>
      <Field label="Address *" value={address1} onChange={setAddress1} />
      <Field label="City *" value={city} onChange={setCity} />
      <Row>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Field label="State" value={state} onChange={setState} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Postal Code *" value={postal} onChange={setPostal} />
        </View>
      </Row>

      <Row style={styles.switchRow}>
        <Text style={styles.label}>Billing address same as service</Text>
        <Switch value={sameBilling} onValueChange={setSameBilling} />
      </Row>
      {!sameBilling && (
        <>
          <SectionTitle>Billing Address</SectionTitle>
          <Field label="Address" value={billing1} onChange={setBilling1} />
          <Field label="City" value={billingCity} onChange={setBillingCity} />
          <Row>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Field label="State" value={billingState} onChange={setBillingState} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Postal Code" value={billingPostal} onChange={setBillingPostal} />
            </View>
          </Row>
        </>
      )}

      {error ? <ErrorText message={error} /> : null}
      <Button title="Continue to Agreement →" onPress={save} loading={busy} style={{ marginTop: 12 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  field: { marginBottom: 10 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 4, fontWeight: '600' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 15,
    color: colors.text,
  },
  switchRow: { marginVertical: 10 },
});
