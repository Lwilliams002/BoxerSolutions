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
import {
  HOME_SIZES,
  STANDARD_PESTS,
  YARD_ANT_TIERS,
  YARD_ANT_PESTS,
  ADDONS,
  WEB_REMOVAL,
  webRemovalFee,
  ODD_JOBS,
  AGREEMENT_TERM_MONTHS as TERM_MONTHS,
  SizeTier,
} from '../../src/lib/pricing';

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
interface LineItem {
  label: string;
  initial: number;
  regular: number;
}

export default function AgreementScreen() {
  const { payload } = useLocalSearchParams<{ payload: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const padRef = useRef<SignaturePadHandle>(null);
  const docRef = useRef<View>(null);

  const [initials, setInitials] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const [homeSizeIdx, setHomeSizeIdx] = useState<number | null>(null);
  const [yardOn, setYardOn] = useState(false);
  const [yardTierIdx, setYardTierIdx] = useState<number | null>(null);
  const [addonKeys, setAddonKeys] = useState<string[]>([]);
  const [webOn, setWebOn] = useState(false);
  const [webSqft, setWebSqft] = useState('');
  const [oddKeys, setOddKeys] = useState<string[]>([]);

  const data = useMemo<CustomerPayload | null>(() => {
    try {
      return JSON.parse(payload ?? '');
    } catch {
      return null;
    }
  }, [payload]);

  const homeSize = homeSizeIdx != null ? HOME_SIZES[homeSizeIdx] : null;
  const yardTier: SizeTier | null = yardOn && yardTierIdx != null ? YARD_ANT_TIERS[yardTierIdx] : null;
  const webFee = webOn ? webRemovalFee(parseFloat(webSqft) || 0) : 0;

  const { lineItems, initialTotal, regularTotal, coveredPests } = useMemo(() => {
    const items: LineItem[] = [];
    const pests = new Set<string>();

    if (homeSize) {
      items.push({ label: `Standard Four Point Service · ${homeSize.label}`, initial: homeSize.initial, regular: homeSize.regular });
      STANDARD_PESTS.forEach((p) => pests.add(p));
    }
    if (yardTier) {
      items.push({ label: `All Yard Ants · ${yardTier.label}`, initial: yardTier.initial, regular: yardTier.regular });
      YARD_ANT_PESTS.forEach((p) => pests.add(p));
    }
    ADDONS.forEach((a) => {
      if (addonKeys.includes(a.key)) {
        items.push({ label: a.label, initial: 0, regular: a.addRegular });
        a.pests.forEach((p) => pests.add(p));
      }
    });
    if (webOn) {
      items.push({ label: `Web Removal + Prevention (${parseFloat(webSqft) || 0} sf)`, initial: webFee, regular: 0 });
      pests.add(WEB_REMOVAL.pest);
    }
    ODD_JOBS.forEach((o) => {
      if (oddKeys.includes(o.key)) {
        items.push({ label: `${o.label} (${o.treatments} treatment${o.treatments > 1 ? 's' : ''})`, initial: o.total, regular: 0 });
        pests.add(o.pest);
      }
    });

    const initialTotal = items.reduce((s, i) => s + i.initial, 0);
    const regularTotal = items.reduce((s, i) => s + i.regular, 0);
    return { lineItems: items, initialTotal, regularTotal, coveredPests: Array.from(pests) };
  }, [homeSize, yardTier, addonKeys, webOn, webSqft, webFee, oddKeys]);

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

  const toggleAddon = (k: string) =>
    setAddonKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  const toggleOdd = (k: string) =>
    setOddKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const submit = async () => {
    if (!homeSize) {
      Alert.alert('Select home size', 'Please choose a home size for the Standard Four Point Service.');
      return;
    }
    if (yardOn && !yardTier) {
      Alert.alert('Select yard size', 'Please choose a size tier for All Yard Ants.');
      return;
    }
    if (webOn && !(parseFloat(webSqft) > 0)) {
      Alert.alert('Enter square footage', 'Please enter the structure size for Web Removal.');
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

      const summary = [
        'SERVICE AGREEMENT',
        ...lineItems.map((i) => `• ${i.label} — Initial ${money(i.initial)} / Regular ${money(i.regular)}`),
        `Initial Total: ${money(initialTotal)}`,
        `Recurring Total: ${money(regularTotal)}/service`,
        `Term: ${TERM_MONTHS} months`,
        `Covered pests: ${coveredPests.join(', ')}`,
        `Signed: ${signedDate}`,
      ].join('\n');
      await api('/notes', {
        method: 'POST',
        body: { customerId: created.id, body: summary, isInternal: false },
      }).catch(() => {});

      const fileName = `service-agreement-${Date.now()}.png`;
      const localUri = await persistLocally(docUri, fileName);
      try {
        await uploadPendingPhoto({ localUri, fileType: 'document', fileName, mimeType: 'image/png', customerId: created.id });
      } catch {
        // Non-fatal; retryable later.
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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>
        {/* ---------- Standard Four Point Service ---------- */}
        <Text style={styles.pickHeader}>Standard Four Point Service</Text>
        <Text style={styles.pickSub}>Select home size — sets the initial &amp; recurring rate.</Text>
        {HOME_SIZES.map((t, i) => {
          const active = homeSizeIdx === i;
          return (
            <TouchableOpacity
              key={t.label}
              style={[styles.tierRow, active && styles.tierRowActive]}
              onPress={() => setHomeSizeIdx(i)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={active ? colors.primaryDark : colors.border}
              />
              <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>{t.label}</Text>
              <Text style={styles.tierPrice}>{money(t.initial)} <Text style={styles.tierPriceSub}>init</Text></Text>
              <Text style={styles.tierPrice}>{money(t.regular)} <Text style={styles.tierPriceSub}>reg</Text></Text>
            </TouchableOpacity>
          );
        })}

        {/* ---------- All Yard Ants ---------- */}
        <TouchableOpacity style={styles.toggleHeader} onPress={() => setYardOn((v) => !v)} activeOpacity={0.8}>
          <View style={[styles.checkbox, yardOn && styles.checkboxOn]}>
            {yardOn && <Ionicons name="checkmark" size={15} color="#0D0D0D" />}
          </View>
          <Text style={styles.toggleTitle}>All Yard Ants (Fire &amp; Carpenter Ants)</Text>
        </TouchableOpacity>
        {yardOn &&
          YARD_ANT_TIERS.map((t, i) => {
            const active = yardTierIdx === i;
            return (
              <TouchableOpacity
                key={t.label}
                style={[styles.tierRow, styles.subTierRow, active && styles.tierRowActive]}
                onPress={() => setYardTierIdx(i)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? colors.primaryDark : colors.border}
                />
                <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>{t.label}</Text>
                <Text style={styles.tierPrice}>{money(t.initial)} <Text style={styles.tierPriceSub}>init</Text></Text>
                <Text style={styles.tierPrice}>{money(t.regular)} <Text style={styles.tierPriceSub}>reg</Text></Text>
              </TouchableOpacity>
            );
          })}

        {/* ---------- Recurring add-ons ---------- */}
        <Text style={styles.pickHeader}>Add-Ons</Text>
        {ADDONS.map((a) => {
          const active = addonKeys.includes(a.key);
          return (
            <TouchableOpacity key={a.key} style={[styles.addonRow, active && styles.addonRowActive]} onPress={() => toggleAddon(a.key)} activeOpacity={0.85}>
              <View style={[styles.checkbox, active && styles.checkboxOn]}>
                {active && <Ionicons name="checkmark" size={15} color="#0D0D0D" />}
              </View>
              <Text style={[styles.addonLabel, active && { color: '#0D0D0D' }]}>{a.label}</Text>
              <Text style={styles.addonPrice}>+{money(a.addRegular)}/reg</Text>
            </TouchableOpacity>
          );
        })}
        {/* Web removal */}
        <TouchableOpacity style={[styles.addonRow, webOn && styles.addonRowActive]} onPress={() => setWebOn((v) => !v)} activeOpacity={0.85}>
          <View style={[styles.checkbox, webOn && styles.checkboxOn]}>
            {webOn && <Ionicons name="checkmark" size={15} color="#0D0D0D" />}
          </View>
          <Text style={[styles.addonLabel, webOn && { color: '#0D0D0D' }]}>Web Removal + Prevention</Text>
          <Text style={styles.addonPrice}>${WEB_REMOVAL.perSqft}/sf · ${WEB_REMOVAL.minimum} min</Text>
        </TouchableOpacity>
        {webOn && (
          <View style={styles.webRow}>
            <Text style={styles.webLabel}>Structure sq ft</Text>
            <TextInput
              style={styles.webInput}
              value={webSqft}
              onChangeText={setWebSqft}
              keyboardType="number-pad"
              placeholder="e.g. 2400"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.webFee}>= {money(webFee)}</Text>
          </View>
        )}

        {/* ---------- Odd jobs ---------- */}
        <Text style={styles.pickHeader}>Single-Pest Specialized (Odd Jobs)</Text>
        {ODD_JOBS.map((o) => {
          const active = oddKeys.includes(o.key);
          return (
            <TouchableOpacity key={o.key} style={[styles.addonRow, active && styles.addonRowActive]} onPress={() => toggleOdd(o.key)} activeOpacity={0.85}>
              <View style={[styles.checkbox, active && styles.checkboxOn]}>
                {active && <Ionicons name="checkmark" size={15} color="#0D0D0D" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addonLabel, active && { color: '#0D0D0D' }]}>{o.label}</Text>
                <Text style={styles.addonMeta}>{o.treatments} treatment{o.treatments > 1 ? 's' : ''}</Text>
              </View>
              <Text style={styles.addonPrice}>{money(o.total)}</Text>
            </TouchableOpacity>
          );
        })}

        {/* Running totals */}
        <View style={styles.totalsBar}>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>INITIAL</Text>
            <Text style={styles.totalValue}>{money(initialTotal)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>RECURRING</Text>
            <Text style={styles.totalValue}>{money(regularTotal)}<Text style={styles.totalPer}>/service</Text></Text>
          </View>
        </View>

        {/* ---------- Captured document ---------- */}
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
              <Text style={styles.body}>{data.customerType === 'commercial' ? 'Commercial' : 'Residential'} Account</Text>
            </View>
          </View>

          {/* Pricing table */}
          <Text style={styles.sectionBarFull}>Services &amp; Pricing</Text>
          <View style={styles.tblHead}>
            <Text style={[styles.tblCell, styles.tblItem, styles.tblHeadText]}>Service</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblHeadText]}>Initial</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblHeadText]}>Regular</Text>
          </View>
          {lineItems.length === 0 ? (
            <Text style={styles.termsMuted}>No services selected yet.</Text>
          ) : (
            lineItems.map((i, idx) => (
              <View key={idx} style={styles.tblRow}>
                <Text style={[styles.tblCell, styles.tblItem]}>{i.label}</Text>
                <Text style={[styles.tblCell, styles.tblNum]}>{i.initial ? money(i.initial) : '—'}</Text>
                <Text style={[styles.tblCell, styles.tblNum]}>{i.regular ? money(i.regular) : '—'}</Text>
              </View>
            ))
          )}
          <View style={styles.tblTotal}>
            <Text style={[styles.tblCell, styles.tblItem, styles.tblTotalText]}>TOTAL</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(initialTotal)}</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(regularTotal)}</Text>
          </View>

          {/* Covered pests */}
          <Text style={styles.sectionBarFull}>Covered Pests</Text>
          {coveredPests.length === 0 ? (
            <Text style={styles.termsMuted}>No pests selected yet.</Text>
          ) : (
            <View style={styles.pestListWrap}>
              {coveredPests.map((p) => (
                <View key={p} style={styles.pestTag}>
                  <Text style={styles.pestTagText}>{p}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Terms */}
          <Text style={styles.sectionBarFull}>Terms &amp; Conditions</Text>
          <Text style={styles.terms}>
            This agreement is for an initial period of {TERM_MONTHS} month(s). You, the customer, may cancel this
            transaction any time prior to midnight of the third business day after the date of this transaction by
            giving written notice of cancellation to {company.name}. Upon completion of the initial service, the
            customer agrees to pay the full initial service charge. Recurring treatments continue at the agreed
            frequency until canceled by the customer. {company.name} will re-treat at no additional charge between
            scheduled visits if covered pest activity persists.
          </Text>
          <Text style={styles.terms}>
            I have read and agree to the terms and conditions of this agreement, including any additional
            disclosures listed above. I confirm my contact information is entered correctly and agree to receive
            account notifications electronically.
          </Text>

          {/* Signature */}
          <View style={styles.signBlock}>
            <View style={styles.initialsRow}>
              <Text style={styles.signLabel}>Customer Initials:</Text>
              <Text style={styles.initialsValue}>{initials.toUpperCase()}</Text>
            </View>
            <Text style={[styles.signLabel, { marginTop: 10 }]}>Customer Signature:</Text>
            <SignaturePad
              ref={padRef}
              height={160}
              onStrokeStart={() => setScrollEnabled(false)}
              onStrokeEnd={() => setScrollEnabled(true)}
            />
            <Text style={styles.signedOn}>Signed on: {signedDate}</Text>
          </View>
        </View>

        {/* ---------- Controls ---------- */}
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
            <Text style={styles.agreeText}>I have read and accept the terms of this service agreement.</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.submitBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
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
  pickHeader: { fontSize: 15, fontWeight: '900', color: colors.text, marginTop: 16, marginBottom: 2 },
  pickSub: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  subTierRow: { marginLeft: 16 },
  tierRowActive: { borderColor: colors.primary, backgroundColor: '#E9FBF6' },
  tierLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: 10 },
  tierLabelActive: { color: '#0D0D0D' },
  tierPrice: { fontSize: 13, fontWeight: '800', color: colors.text, width: 78, textAlign: 'right' },
  tierPriceSub: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  toggleHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 8 },
  toggleTitle: { fontSize: 15, fontWeight: '900', color: colors.text, marginLeft: 10 },
  addonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  addonRowActive: { borderColor: colors.primary, backgroundColor: '#E9FBF6' },
  addonLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: 10 },
  addonMeta: { fontSize: 11, color: colors.textMuted, marginLeft: 10, marginTop: 1 },
  addonPrice: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, marginLeft: 8 },
  webRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 16, marginBottom: 8 },
  webLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  webInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.text,
    marginHorizontal: 10,
    minWidth: 90,
  },
  webFee: { fontSize: 14, fontWeight: '800', color: colors.text },
  totalsBar: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 14,
  },
  totalCol: { flex: 1, alignItems: 'center' },
  totalDivider: { width: 1, backgroundColor: '#2A2A2A' },
  totalLabel: { color: '#6B7C78', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  totalValue: { color: '#2DC4A2', fontSize: 22, fontWeight: '900', marginTop: 2 },
  totalPer: { color: '#6B7C78', fontSize: 12, fontWeight: '700' },
  doc: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  brandHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D0D0D', borderRadius: 10, padding: 12 },
  logo: { width: 44, height: 44 },
  brandName: { color: '#fff', fontSize: 18, fontWeight: '900' },
  brandTagline: { color: '#2DC4A2', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  brandContact: { alignItems: 'flex-end' },
  brandContactLine: { color: '#B9C9C5', fontSize: 9, lineHeight: 13 },
  docTitle: { textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.text, marginTop: 14, marginBottom: 12, letterSpacing: 1 },
  twoCol: { flexDirection: 'row', marginHorizontal: -4 },
  col: { flex: 1, marginHorizontal: 4 },
  sectionBar: { backgroundColor: colors.primary, color: '#0D0D0D', fontWeight: '800', fontSize: 12, textAlign: 'center', paddingVertical: 4, borderRadius: 4, marginBottom: 6 },
  sectionBarFull: { backgroundColor: colors.primary, color: '#0D0D0D', fontWeight: '800', fontSize: 12, textAlign: 'center', paddingVertical: 4, borderRadius: 4, marginTop: 14, marginBottom: 8 },
  body: { fontSize: 12, color: colors.text, lineHeight: 17 },
  bodyStrong: { fontSize: 12, color: colors.text, fontWeight: '800', lineHeight: 17 },
  tblHead: { flexDirection: 'row', borderBottomWidth: 1.5, borderColor: colors.text, paddingBottom: 4, marginBottom: 2 },
  tblRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 5 },
  tblTotal: { flexDirection: 'row', paddingVertical: 6, marginTop: 2, borderTopWidth: 1.5, borderColor: colors.text },
  tblCell: { fontSize: 11.5, color: colors.text },
  tblItem: { flex: 1, paddingRight: 6 },
  tblNum: { width: 66, textAlign: 'right', fontWeight: '700' },
  tblHeadText: { fontWeight: '800', fontSize: 11, color: colors.textMuted },
  tblTotalText: { fontWeight: '900', fontSize: 12.5 },
  termsMuted: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
  pestListWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pestTag: { backgroundColor: '#E9FBF6', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, marginRight: 6, marginBottom: 6, borderWidth: 1, borderColor: colors.border },
  pestTagText: { fontSize: 11, color: colors.primaryDark, fontWeight: '700' },
  terms: { fontSize: 10.5, color: colors.textMuted, lineHeight: 15, marginBottom: 8 },
  signBlock: { marginTop: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 },
  initialsRow: { flexDirection: 'row', alignItems: 'center' },
  signLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  initialsValue: { fontSize: 14, fontWeight: '900', color: colors.primaryDark, marginLeft: 10, letterSpacing: 2 },
  signedOn: { fontSize: 10, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  controls: { marginTop: 14 },
  controlLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '700', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 15, color: colors.text, letterSpacing: 2 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 8 },
  clearBtnText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13, marginLeft: 4 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary },
  agreeText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18, marginLeft: 10 },
  bottomBar: { padding: 14, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.border },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15 },
  submitText: { color: '#0D0D0D', fontWeight: '900', fontSize: 16, marginLeft: 8 },
});
