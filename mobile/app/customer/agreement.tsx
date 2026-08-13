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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { persistLocally, uploadPendingPhoto } from '../../src/lib/photos';
import { SignaturePad, SignaturePadHandle } from '../../src/components/SignaturePad';
import { colors, company, money } from '../../src/lib/theme';
import { Loading } from '../../src/components/ui';

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
interface ServiceItem {
  id: string;
  name: string;
  price: string;
  isRecurring: boolean;
  serviceType: string;
  categoryName: string | null;
  durationMinutes: number;
}

const TERM_MONTHS = 12;

const PEST_GROUPS: { group: string; pests: string[] }[] = [
  { group: 'General Pest Control', pests: ['Roaches', 'Ants', 'Spiders', 'Earwigs', 'Silverfish', 'Centipedes', 'Millipedes'] },
  { group: 'Flying / Insect Control', pests: ['Mosquitoes', 'Wasps', 'Hornets', 'No-see-ums', 'Fleas'] },
  { group: 'Wood-Destroying Pests', pests: ['Termites'] },
  { group: 'Wildlife / Other', pests: ['Rodents'] },
  { group: 'Commercial', pests: ['Commercial Pest Control / IPM'] },
];

export default function AgreementScreen() {
  const { payload } = useLocalSearchParams<{ payload: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const padRef = useRef<SignaturePadHandle>(null);
  const docRef = useRef<View>(null);
  const [initials, setInitials] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recurringId, setRecurringId] = useState<string | null>(null);
  const [initialId, setInitialId] = useState<string | null>(null);
  const [pests, setPests] = useState<string[]>([]);

  const data = useMemo<CustomerPayload | null>(() => {
    try {
      return JSON.parse(payload ?? '');
    } catch {
      return null;
    }
  }, [payload]);

  const { data: servicesData, isLoading: loadingServices } = useQuery({
    queryKey: ['services-catalog'],
    queryFn: () => api<{ items: ServiceItem[] }>('/services?pageSize=100'),
  });

  const services = (servicesData?.items ?? []).filter((s: any) => s.isActive !== false);
  const recurringPlans = services.filter((s) => s.isRecurring);
  const initialOptions = services.filter((s) => !s.isRecurring);

  const recurringPlan = recurringPlans.find((s) => s.id === recurringId) ?? null;
  const initialPlan = initialOptions.find((s) => s.id === initialId) ?? null;
  const recurringPrice = recurringPlan ? parseFloat(recurringPlan.price) : 0;
  const initialPrice = initialPlan ? parseFloat(initialPlan.price) : 0;

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

  const togglePest = (p: string) =>
    setPests((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async () => {
    if (!recurringPlan && !initialPlan) {
      Alert.alert('Select a plan', 'Please choose at least an initial or recurring service.');
      return;
    }
    if (pests.length === 0) {
      Alert.alert('Select pests', 'Please select at least one pest to be serviced.');
      return;
    }
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
      const docUri = await captureRef(docRef, { format: 'png', quality: 0.95, result: 'tmpfile' });
      const created = await api<{ id: string }>('/customers', { method: 'POST', body: data });

      // Persist a structured summary of the plan & covered pests as a customer note.
      const summary = [
        'SERVICE AGREEMENT',
        initialPlan ? `Initial: ${initialPlan.name} (${money(initialPrice)})` : null,
        recurringPlan ? `Recurring: ${recurringPlan.name} (${money(recurringPrice)}/service)` : null,
        `Term: ${TERM_MONTHS} months`,
        `Covered pests: ${pests.join(', ')}`,
        `Signed: ${signedDate}`,
      ]
        .filter(Boolean)
        .join('\n');
      await api('/notes', {
        method: 'POST',
        body: { customerId: created.id, body: summary, isInternal: false },
      }).catch(() => {});

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
        // Non-fatal; customer exists and document can be retried later.
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

  if (loadingServices) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ---- Interactive: plan selection ---- */}
        <Text style={styles.pickHeader}>Choose a Recurring Plan</Text>
        <View style={styles.planWrap}>
          {recurringPlans.length === 0 ? (
            <Text style={styles.muted}>No recurring plans available.</Text>
          ) : (
            recurringPlans.map((s) => {
              const active = recurringId === s.id;
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.planCard, active && styles.planCardActive]}
                  onPress={() => setRecurringId(active ? null : s.id)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planName, active && styles.planNameActive]}>{s.name}</Text>
                    <Text style={[styles.planMeta, active && styles.planMetaActive]}>
                      {s.categoryName ?? 'Service'} · {s.durationMinutes} min
                    </Text>
                  </View>
                  <Text style={[styles.planPrice, active && styles.planNameActive]}>{money(s.price)}</Text>
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={active ? '#0D0D0D' : colors.border}
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.pickHeader}>Initial Service (optional)</Text>
        <View style={styles.planWrap}>
          {initialOptions.map((s) => {
            const active = initialId === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.planCard, active && styles.planCardActive]}
                onPress={() => setInitialId(active ? null : s.id)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, active && styles.planNameActive]}>{s.name}</Text>
                  <Text style={[styles.planMeta, active && styles.planMetaActive]}>
                    {s.categoryName ?? 'Service'}
                  </Text>
                </View>
                <Text style={[styles.planPrice, active && styles.planNameActive]}>{money(s.price)}</Text>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={active ? '#0D0D0D' : colors.border}
                  style={{ marginLeft: 8 }}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ---- Interactive: pest selection ---- */}
        <Text style={styles.pickHeader}>Pests To Be Serviced</Text>
        {PEST_GROUPS.map((g) => (
          <View key={g.group} style={{ marginBottom: 8 }}>
            <Text style={styles.pestGroup}>{g.group}</Text>
            <View style={styles.chipWrap}>
              {g.pests.map((p) => {
                const active = pests.includes(p);
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.pestChip, active && styles.pestChipActive]}
                    onPress={() => togglePest(p)}
                    activeOpacity={0.8}
                  >
                    {active && <Ionicons name="checkmark" size={14} color="#0D0D0D" style={{ marginRight: 4 }} />}
                    <Text style={[styles.pestChipText, active && styles.pestChipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {/* ---- Captured document ---- */}
        <View ref={docRef} collapsable={false} style={styles.doc}>
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

          {/* Covered pests */}
          <Text style={styles.sectionBarFull}>Covered Pests</Text>
          {pests.length === 0 ? (
            <Text style={styles.termsMuted}>No pests selected yet.</Text>
          ) : (
            <View style={styles.pestListWrap}>
              {pests.map((p) => (
                <View key={p} style={styles.pestTag}>
                  <Text style={styles.pestTagText}>{p}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Plan / pricing */}
          <Text style={styles.sectionBarFull}>Service Plan &amp; Pricing</Text>
          {initialPlan ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Initial · {initialPlan.name}</Text>
              <Text style={styles.priceValue}>{money(initialPrice)}</Text>
            </View>
          ) : null}
          {recurringPlan ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Recurring · {recurringPlan.name}</Text>
              <Text style={styles.priceValue}>{money(recurringPrice)}/service</Text>
            </View>
          ) : null}
          {!initialPlan && !recurringPlan ? (
            <Text style={styles.termsMuted}>No plan selected yet.</Text>
          ) : null}
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
            scheduled visits if covered pest activity persists.
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

        {/* ---- Interactive controls ---- */}
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
  muted: { color: colors.textMuted, fontSize: 13, padding: 8 },
  pickHeader: { fontSize: 15, fontWeight: '900', color: colors.text, marginTop: 12, marginBottom: 8 },
  planWrap: { marginBottom: 4 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  planCardActive: { borderColor: colors.primary, backgroundColor: '#E9FBF6' },
  planName: { fontSize: 15, fontWeight: '800', color: colors.text },
  planNameActive: { color: '#0D0D0D' },
  planMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  planMetaActive: { color: colors.primaryDark },
  planPrice: { fontSize: 15, fontWeight: '900', color: colors.text },
  pestGroup: { fontSize: 12, fontWeight: '800', color: colors.primaryDark, marginBottom: 6, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  pestChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pestChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  pestChipTextActive: { color: '#0D0D0D', fontWeight: '800' },
  doc: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
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
  pestListWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pestTag: {
    backgroundColor: '#E9FBF6',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pestTagText: { fontSize: 11, color: colors.primaryDark, fontWeight: '700' },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  priceLabel: { fontSize: 12, color: colors.text, flex: 1, marginRight: 8 },
  priceValue: { fontSize: 12, color: colors.text, fontWeight: '800' },
  terms: { fontSize: 10.5, color: colors.textMuted, lineHeight: 15, marginBottom: 8 },
  termsMuted: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
  signBlock: { marginTop: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 },
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
  bottomBar: { padding: 14, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.border },
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
