import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { persistLocally, uploadPendingPhoto } from '../../src/lib/photos';
import { SignaturePad, SignaturePadHandle } from '../../src/components/SignaturePad';
import { colors, company, money } from '../../src/lib/theme';

interface ServiceLocation {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}
interface CustomerPayload {
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  customerType: string;
  billingAddressLine1: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  serviceLocation: ServiceLocation;
}

const INITIAL_PRICE = 149;
const RECURRING_PRICE = 89;
const TERM_MONTHS = 12;

export default function AgreementScreen() {
  const { payload } = useLocalSearchParams<{ payload: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const padRef = useRef<SignaturePadHandle>(null);
  const docRef = useRef<View>(null);
  const [initials, setInitials] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const data = useMemo<CustomerPayload | null>(() => {
    try {
      return JSON.parse(payload ?? '');
    } catch {
      return null;
    }
  }, [payload]);

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text>Missing customer data.</Text>
      </View>
    );
  }

  const name = data.company ?? `${data.firstName} ${data.lastName}`;
  const loc = data.serviceLocation;
  const signedDate = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const submit = async () => {
    if (!agreed) {
      Alert.alert('Agreement required', 'Please check the box to accept the terms.');
      return;
    }
    if (!initials.trim()) {
      Alert.alert('Initials required', 'Please enter your initials.');
      return;
    }
    if (padRef.current?.isEmpty()) {
      Alert.alert('Signature required', 'Please sign the agreement before continuing.');
      return;
    }
    setBusy(true);
    try {
      // 1. Capture the full branded agreement (with signature) as an image.
      const docUri = await captureRef(docRef, { format: 'png', quality: 0.95, result: 'tmpfile' });

      // 2. Create the customer.
      const created = await api<{ id: string }>('/customers', { method: 'POST', body: data });

      // 3. Upload the signed agreement to Wasabi as a customer document.
      const fileName = `service-agreement-${Date.now()}.png`;
      const localUri = await persistLocally(docUri, fileName);
      try {
        await uploadPendingPhoto({
          localUri,
          fileType: 'document',
          fileName,
          mimeType: 'image/png',
          customerId: created.id,
        });
      } catch {
        // Non-fatal: customer is created; the document upload can be retried later.
      }

      void qc.invalidateQueries({ queryKey: ['customers'] });
      Alert.alert('Agreement Signed', `${name} has been added and the signed agreement was saved.`, [
        { text: 'Done', onPress: () => router.replace(`/customer/${created.id}`) },
      ]);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Captured document */}
        <View ref={docRef} collapsable={false} style={styles.doc}>
          {/* Brand header */}
          <View style={styles.brandHeader}>
            <Image source={require('../../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.brandName}>{company.name}</Text>
              <Text style={styles.brandTagline}>{company.tagline.toUpperCase()}</Text>
            </View>
            <View style={styles.brandContact}>
              <Text style={styles.brandContactLine}>{company.addressLine1}</Text>
              <Text style={styles.brandContactLine}>{company.addressLine2}</Text>
              <Text style={styles.brandContactLine}>{company.phone}</Text>
              <Text style={styles.brandContactLine}>{company.license}</Text>
            </View>
          </View>

          <Text style={styles.docTitle}>SERVICE AGREEMENT</Text>

          {/* Two column: service address + customer info */}
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.sectionBar}>Service Address</Text>
              <Text style={styles.bodyStrong}>{name}</Text>
              <Text style={styles.body}>{loc.addressLine1}</Text>
              <Text style={styles.body}>{loc.city}, {loc.state} {loc.postalCode}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.sectionBar}>Customer Information</Text>
              {data.email ? <Text style={styles.body}>{data.email}</Text> : null}
              {data.phone ? <Text style={styles.body}>{data.phone}</Text> : null}
              <Text style={styles.body}>
                {data.customerType === 'commercial' ? 'Commercial' : 'Residential'} Account
              </Text>
            </View>
          </View>

          {/* Plan / pricing */}
          <Text style={styles.sectionBarFull}>Service Plan &amp; Pricing</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Initial Service</Text>
            <Text style={styles.priceValue}>{money(INITIAL_PRICE)}</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Recurring Service (monthly)</Text>
            <Text style={styles.priceValue}>{money(RECURRING_PRICE)}</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Agreement Term</Text>
            <Text style={styles.priceValue}>{TERM_MONTHS} months</Text>
          </View>

          {/* Terms */}
          <Text style={styles.sectionBarFull}>Terms &amp; Conditions</Text>
          <Text style={styles.terms}>
            This agreement is for an initial period of {TERM_MONTHS} month(s). You, the customer, may cancel this
            transaction any time prior to midnight of the third business day after the date of this transaction by
            giving written notice of cancellation to {company.name}. Upon completion of the initial service, the
            customer agrees to pay the full service charge. Recurring treatments will continue at the agreed
            frequency until canceled by the customer. {company.name} will re-treat at no additional charge between
            scheduled visits if pest activity persists.
          </Text>
          <Text style={styles.terms}>
            I have read and agree to the terms and conditions of this agreement, including any additional
            disclosures listed above. I confirm my contact information is entered correctly and agree to receive
            account notifications electronically.
          </Text>

          {/* Signature block */}
          <View style={styles.signBlock}>
            <View style={styles.initialsRow}>
              <Text style={styles.signLabel}>Customer Initials:</Text>
              <Text style={styles.initialsValue}>{initials.toUpperCase()}</Text>
            </View>
            <Text style={[styles.signLabel, { marginTop: 10 }]}>Customer Signature:</Text>
            <SignaturePad ref={padRef} height={160} />
            <Text style={styles.signedOn}>Signed on: {signedDate}</Text>
          </View>
        </View>

        {/* Interactive controls (not captured) */}
        <View style={styles.controls}>
          <Text style={styles.controlLabel}>Your Initials</Text>
          <TextInput
            style={styles.input}
            value={initials}
            onChangeText={(t) => setInitials(t.slice(0, 4))}
            autoCapitalize="characters"
            placeholder="e.g. JS"
            placeholderTextColor={colors.textMuted}
            maxLength={4}
          />

          <TouchableOpacity style={styles.clearBtn} onPress={() => padRef.current?.clear()}>
            <Ionicons name="refresh" size={16} color={colors.primaryDark} />
            <Text style={styles.clearBtnText}>Clear Signature</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.agreeRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.7}>
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed && <Ionicons name="checkmark" size={16} color="#0D0D0D" />}
            </View>
            <Text style={styles.agreeText}>
              I have read and accept the terms of this service agreement.
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.submitBtn, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={20} color="#0D0D0D" />
          <Text style={styles.submitText}>{busy ? 'Saving…' : 'Agree & Create Customer'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, paddingBottom: 24 },
  doc: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    padding: 12,
  },
  logo: { width: 44, height: 44 },
  brandName: { color: '#fff', fontSize: 18, fontWeight: '900' },
  brandTagline: { color: '#2DC4A2', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  brandContact: { alignItems: 'flex-end' },
  brandContactLine: { color: '#B9C9C5', fontSize: 9, lineHeight: 13 },
  docTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    marginTop: 14,
    marginBottom: 12,
    letterSpacing: 1,
  },
  twoCol: { flexDirection: 'row', marginHorizontal: -4 },
  col: { flex: 1, marginHorizontal: 4 },
  sectionBar: {
    backgroundColor: colors.primary,
    color: '#0D0D0D',
    fontWeight: '800',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 6,
  },
  sectionBarFull: {
    backgroundColor: colors.primary,
    color: '#0D0D0D',
    fontWeight: '800',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 14,
    marginBottom: 8,
  },
  body: { fontSize: 12, color: colors.text, lineHeight: 17 },
  bodyStrong: { fontSize: 12, color: colors.text, fontWeight: '800', lineHeight: 17 },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  priceLabel: { fontSize: 12, color: colors.text },
  priceValue: { fontSize: 12, color: colors.text, fontWeight: '800' },
  terms: { fontSize: 10.5, color: colors.textMuted, lineHeight: 15, marginBottom: 8 },
  signBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
  },
  initialsRow: { flexDirection: 'row', alignItems: 'center' },
  signLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  initialsValue: { fontSize: 14, fontWeight: '900', color: colors.primaryDark, marginLeft: 10, letterSpacing: 2 },
  signedOn: { fontSize: 10, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  controls: { marginTop: 14 },
  controlLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '700', marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 2,
  },
  clearBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 8 },
  clearBtnText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13, marginLeft: 4 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: colors.primary },
  agreeText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  bottomBar: {
    padding: 14,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitText: { color: '#0D0D0D', fontWeight: '900', fontSize: 16, marginLeft: 8 },
});
