import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  TouchableOpacity,
  Image,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { persistLocally, uploadPendingPhoto } from '../../src/lib/photos';
import { captureView } from '../../src/lib/capture';
import { SignaturePad, SignaturePadHandle } from '../../src/components/SignaturePad';
import { SignatureMark } from '../../src/components/SignatureMark';
import { colors, money } from '../../src/lib/theme';
import { useAuth } from '../../src/lib/authStore';
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
import { pestImage } from '../../src/lib/pestImages';
import { useCompanyInfo } from '../../src/lib/companyInfo';
import {
  DEFAULT_SERVICE_FREQUENCY, SERVICE_FREQUENCIES, SERVICE_FREQUENCY_LABELS, SERVICE_FREQUENCY_SHORT,
  ServiceFrequency, buildChargeSchedule, parseServiceFrequency, scheduleCellLabel, todayIso,
} from '../../src/lib/serviceSchedule';

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
  key: string;
  label: string;
  initial: number;
  regular: number;
}

/** Current agreement as returned by GET /agreements/current (update mode). */
interface BaseAgreement {
  lineItems: { label: string; initial: number; regular: number }[];
  initialTotal: number | null;
  recurringTotal: number | null;
  currentRecurringAmount: number | null;
  currentFrequency?: string | null;
  frequency?: string | null;
  nextDueDate?: string | null;
  selections: {
    homeSize?: string | null;
    yardTier?: string | null;
    addons?: unknown;
    web?: unknown;
    odd?: unknown;
    overrides?: unknown;
    itemKeys?: unknown;
    frequency?: unknown;
  } | null;
}

type PriceField = 'initial' | 'regular';
type PriceOverride = Partial<Record<PriceField, string>>;

function normalizePriceInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  const head = cleaned.slice(0, firstDot + 1);
  const tail = cleaned.slice(firstDot + 1).replace(/\./g, '');
  return `${head}${tail}`.slice(0, 12);
}

function parseOverride(value?: string) {
  if (!value || !value.trim()) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export default function AgreementScreen() {
  const { payload, customerId, mode, base } = useLocalSearchParams<{ payload: string; customerId?: string; mode?: string; base?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const docRef = useRef<View>(null);
  const user = useAuth((state) => state.user);
  const company = useCompanyInfo();
  const existingCustomerId = typeof customerId === 'string' && customerId ? customerId : null;
  const isOwner = !!user?.roles?.includes('OWNER');
  // Update mode: build on the customer's current agreement. Only items that
  // are new versus that agreement are charged now; the recurring amount is
  // replaced by the new total.
  const baseAgreement = useMemo<BaseAgreement | null>(() => {
    if (mode !== 'update' || typeof base !== 'string' || !base) return null;
    try {
      return JSON.parse(base) as BaseAgreement;
    } catch {
      return null;
    }
  }, [mode, base]);
  const isUpdate = !!existingCustomerId && !!baseAgreement;

  const [initials, setInitials] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [sendForSignature, setSendForSignature] = useState(false);

  const [homeSizeIdx, setHomeSizeIdx] = useState<number | null>(null);
  const [yardOn, setYardOn] = useState(false);
  const [yardTierIdx, setYardTierIdx] = useState<number | null>(null);
  const [addonKeys, setAddonKeys] = useState<string[]>([]);
  const [webOn, setWebOn] = useState(false);
  const [webSqft, setWebSqft] = useState('');
  const [oddKeys, setOddKeys] = useState<string[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, PriceOverride>>({});
  const [initialDiscountInput, setInitialDiscountInput] = useState('');
  const [frequency, setFrequency] = useState<ServiceFrequency>(DEFAULT_SERVICE_FREQUENCY);

  // Pre-fill the builder from the current agreement's saved selections.
  useEffect(() => {
    const cadence = parseServiceFrequency(baseAgreement?.currentFrequency)
      ?? parseServiceFrequency(baseAgreement?.frequency)
      ?? parseServiceFrequency(baseAgreement?.selections?.frequency);
    if (cadence) setFrequency(cadence);
    const sel = baseAgreement?.selections;
    if (!sel) return;
    if (typeof sel.homeSize === 'string') {
      const idx = HOME_SIZES.findIndex((h) => h.label === sel.homeSize);
      if (idx >= 0) setHomeSizeIdx(idx);
    }
    if (typeof sel.yardTier === 'string') {
      const idx = YARD_ANT_TIERS.findIndex((t) => t.label === sel.yardTier);
      if (idx >= 0) { setYardOn(true); setYardTierIdx(idx); }
    }
    if (Array.isArray(sel.addons)) setAddonKeys(sel.addons.filter((k): k is string => typeof k === 'string'));
    if (sel.web && typeof sel.web === 'object') {
      const web = sel.web as { on?: boolean; sqft?: string };
      setWebOn(!!web.on);
      if (typeof web.sqft === 'string') setWebSqft(web.sqft);
    }
    if (Array.isArray(sel.odd)) setOddKeys(sel.odd.filter((k): k is string => typeof k === 'string'));
    if (sel.overrides && typeof sel.overrides === 'object') setPriceOverrides(sel.overrides as Record<string, PriceOverride>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseAgreement]);

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
  const { baseLineItems, coveredPests } = useMemo(() => {
    const items: LineItem[] = [];
    const pests = new Set<string>();

    if (homeSize) {
      items.push({
        key: `standard:${homeSize.label}`,
        label: `Standard Four Point Service · ${homeSize.label}`,
        initial: homeSize.initial,
        regular: homeSize.regular,
      });
      STANDARD_PESTS.forEach((p) => pests.add(p));
    }
    if (yardTier) {
      items.push({
        key: `yard:${yardTier.label}`,
        label: `All Yard Ants · ${yardTier.label}`,
        initial: yardTier.initial,
        regular: yardTier.regular,
      });
      YARD_ANT_PESTS.forEach((p) => pests.add(p));
    }
    ADDONS.forEach((a) => {
      if (addonKeys.includes(a.key)) {
        items.push({ key: `addon:${a.key}`, label: a.label, initial: 0, regular: a.addRegular });
        a.pests.forEach((p) => pests.add(p));
      }
    });
    if (webOn) {
      items.push({ key: 'web-removal', label: `Web Removal + Prevention (${parseFloat(webSqft) || 0} sf)`, initial: webFee, regular: 0 });
      pests.add(WEB_REMOVAL.pest);
    }
    ODD_JOBS.forEach((o) => {
      if (oddKeys.includes(o.key)) {
        items.push({
          key: `odd:${o.key}`,
          label: `${o.label} (${o.treatments} treatment${o.treatments > 1 ? 's' : ''})`,
          initial: o.total,
          regular: 0,
        });
        pests.add(o.pest);
      }
    });

    return { baseLineItems: items, coveredPests: Array.from(pests) };
  }, [homeSize, yardTier, addonKeys, webOn, webSqft, webFee, oddKeys]);

  const lineItems = useMemo(
    () =>
      baseLineItems.map((item) => {
        if (!isOwner) return item;
        const override = priceOverrides[item.key];
        const initial = parseOverride(override?.initial);
        const regular = parseOverride(override?.regular);
        return {
          ...item,
          initial: initial ?? item.initial,
          regular: regular ?? item.regular,
        };
      }),
    [baseLineItems, isOwner, priceOverrides],
  );

  const initialSubtotal = useMemo(() => lineItems.reduce((s, i) => s + i.initial, 0), [lineItems]);
  const regularTotal = useMemo(() => lineItems.reduce((s, i) => s + i.regular, 0), [lineItems]);
  // Items the customer already has under the current agreement (matched by
  // builder key when available, otherwise by label for older agreements).
  const isBaseItem = useMemo(() => {
    const keys = new Set<string>(Array.isArray(baseAgreement?.selections?.itemKeys) ? (baseAgreement!.selections!.itemKeys as string[]) : []);
    const labels = new Set<string>((baseAgreement?.lineItems ?? []).map((i) => i.label));
    return (item: LineItem) => keys.has(item.key) || labels.has(item.label);
  }, [baseAgreement]);
  /** Items whose initial fee is charged at signing: everything for a new agreement, only new items for an update. */
  const chargeItems = useMemo(
    () => lineItems.filter((i) => i.initial > 0 && (!isUpdate || !isBaseItem(i))),
    [lineItems, isUpdate, isBaseItem],
  );
  const chargeSubtotal = useMemo(() => chargeItems.reduce((s, i) => s + i.initial, 0), [chargeItems]);
  const previousRecurring = baseAgreement ? (baseAgreement.currentRecurringAmount ?? baseAgreement.recurringTotal ?? 0) : 0;
  const initialDiscount = useMemo(
    () => Math.min(parseOverride(initialDiscountInput) ?? 0, isUpdate ? chargeSubtotal : initialSubtotal),
    [initialDiscountInput, initialSubtotal, chargeSubtotal, isUpdate],
  );
  const discountWasCapped = useMemo(() => {
    const requested = parseOverride(initialDiscountInput);
    return requested != null && requested > initialSubtotal;
  }, [initialDiscountInput, initialSubtotal]);
  const initialTotal = useMemo(
    () => Math.max(0, initialSubtotal - initialDiscount),
    [initialSubtotal, initialDiscount],
  );
  /** Amount charged at signing. */
  const chargeTotal = useMemo(
    () => Math.max(0, chargeSubtotal - initialDiscount),
    [chargeSubtotal, initialDiscount],
  );
  /** Every charge across the term at the chosen cadence, shown on the document. */
  const chargeSchedule = useMemo(
    () => buildChargeSchedule({
      startDate: todayIso(),
      frequency,
      termMonths: TERM_MONTHS,
      initialAmount: isUpdate ? chargeTotal : initialTotal,
      recurringAmount: regularTotal,
      firstRegularDate: isUpdate ? baseAgreement?.nextDueDate ?? null : null,
    }),
    [frequency, isUpdate, chargeTotal, initialTotal, regularTotal, baseAgreement],
  );

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

  const setPriceOverride = (lineKey: string, field: PriceField, value: string) => {
    const normalized = normalizePriceInput(value);
    setPriceOverrides((prev) => {
      const existing = prev[lineKey] ?? {};
      const nextEntry: PriceOverride = { ...existing, [field]: normalized };
      return { ...prev, [lineKey]: nextEntry };
    });
  };

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
    if (!agreed && !sendForSignature) {
      Alert.alert('Agreement required', 'Please check the box to accept the terms.');
      return;
    }
    if (!sendForSignature && !initials.trim()) {
      Alert.alert('Initials required', 'Please enter your initials.');
      return;
    }
    if (!sendForSignature && !signatureDataUrl) {
      Alert.alert('Signature required', 'Please sign the agreement before continuing.');
      return;
    }
    if (sendForSignature && !data.email) {
      Alert.alert('Customer email required', 'Add an email address on the customer details screen to send for review and signature.');
      return;
    }
    setBusy(true);
    try {
      const targetCustomerId =
        existingCustomerId ??
        (await api<{ id: string }>('/customers', { method: 'POST', body: data })).id;
      let signatureRequestSent = !sendForSignature;
      let initialInvoiceId: string | null = null;

      const selections = {
        homeSize: homeSize?.label ?? null,
        yardTier: yardTier?.label ?? null,
        addons: addonKeys,
        web: { on: webOn, sqft: webSqft },
        odd: oddKeys,
        overrides: priceOverrides,
        itemKeys: lineItems.map((i) => i.key),
        frequency,
      };
      const summary = [
        'SERVICE AGREEMENT',
        sendForSignature ? 'Status: UNSIGNED (sent by email for review/signature)' : 'Status: SIGNED',
        ...lineItems.map((i) => `• ${i.label} — Initial ${money(i.initial)} / Regular ${money(i.regular)}`),
        `Initial Subtotal: ${money(initialSubtotal)}`,
        `Initial Discount: -${money(initialDiscount)}`,
        `Initial Total: ${money(initialTotal)}`,
        `Recurring Total: ${money(regularTotal)}/service`,
        `Frequency: ${frequency}`,
        ...(isUpdate
          ? [
            'Update of previous agreement: YES',
            `Initial Due Now: ${money(chargeTotal)}`,
            `Previous Recurring Total: ${money(previousRecurring)}/service`,
          ]
          : []),
        `Selections: ${JSON.stringify(selections)}`,
        `Term: ${TERM_MONTHS} months`,
        `Covered pests: ${coveredPests.join(', ')}`,
        `Signed: ${signedDate}`,
      ].join('\n');
      await api('/notes', {
        method: 'POST',
        body: { customerId: targetCustomerId, body: summary, isInternal: false },
      }).catch(() => {});

      if (sendForSignature) {
        try {
          const docUri = await captureView(docRef);
          const fileName = `service-agreement-unsigned-${Date.now()}.png`;
          const localUri = await persistLocally(docUri, fileName);
          await uploadPendingPhoto({
            localUri,
            fileType: 'document',
            fileName,
            mimeType: 'image/png',
            customerId: targetCustomerId,
          });
        } catch {
          // Fallback placeholder record so email signing can still proceed when capture is unavailable.
          try {
            await api('/files/upload-request', {
              method: 'POST',
              body: {
                fileType: 'document',
                fileName: `service-agreement-unsigned-${Date.now()}.pdf`,
                mimeType: 'application/pdf',
                customerId: targetCustomerId,
              },
            });
          } catch {
            // Keep customer creation success even if document placeholder creation fails.
          }
        }
        try {
          await api('/communications/agreement-review-request', {
            method: 'POST',
            body: { customerId: targetCustomerId },
          });
        } catch {
          signatureRequestSent = false;
        }
      } else {
        try {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const docUri = await captureView(docRef);
          const fileName = `service-agreement-${Date.now()}.png`;
          const localUri = await persistLocally(docUri, fileName);
          try {
            await uploadPendingPhoto({ localUri, fileType: 'document', fileName, mimeType: 'image/png', customerId: targetCustomerId });
          } catch {
            // Non-fatal; retryable later.
          }
        } catch {
          // Continue without image attachment when capture is unavailable.
        }

        // New customers: invoice the full initial total. Updates: invoice only
        // the items that are new versus the current agreement. Charge it right
        // away when a payment method is already on file.
        // Every signing that carries an initial amount is invoiced: a new
        // customer or a fresh "Add Agreement" gets the full initial total,
        // an update only the newly added items (chargeItems handles both).
        if (chargeTotal > 0.009) {
          try {
            const initialChargeItems = chargeItems
              .map((item) => ({
                description: `${item.label} (Initial Service)`,
                quantity: 1,
                unitPrice: Number(item.initial.toFixed(2)),
                discount: 0,
                taxable: false,
              }));
            if (initialChargeItems.length > 0) {
              let remainingDiscount = Number(initialDiscount.toFixed(2));
              for (const item of initialChargeItems) {
                if (remainingDiscount <= 0) break;
                const applied = Math.min(item.unitPrice, remainingDiscount);
                item.discount = Number(applied.toFixed(2));
                remainingDiscount = Number((remainingDiscount - applied).toFixed(2));
              }
              const invoice = await api<{ id: string }>('/invoices', {
                method: 'POST',
                body: {
                  customerId: targetCustomerId,
                  dueDate: new Date().toISOString().slice(0, 10),
                  taxRate: 0,
                  notes: isUpdate ? 'Agreement update charge (new services)' : 'Initial agreement charge',
                  items: initialChargeItems,
                },
              });
              initialInvoiceId = invoice.id;

              try {
                const methods = await api<any[]>(`/payment-methods?customerId=${targetCustomerId}`);
                const defaultMethod = methods.find((method: any) => method.isDefault) ?? methods[0];
                if (defaultMethod) {
                  await api('/payments/charge', {
                    method: 'POST',
                    body: { invoiceId: invoice.id, paymentMethodId: defaultMethod.id },
                  });
                }
              } catch {
                // Keep the agreement flow successful and let the customer complete the card setup later.
              }
            }
          } catch {
            // Keep signed-agreement flow successful even if invoice generation fails.
          }
        }

        // Register/update the customer's recurring "Regular" charge so it shows
        // in the Invoices section with a charge action. Re-signing replaces the amount.
        if (regularTotal > 0.009) {
          try {
            await api('/recurring-charges', {
              method: 'POST',
              body: { customerId: targetCustomerId, amount: Number(regularTotal.toFixed(2)), frequency, startDate: todayIso(), isUpdate },
            });
          } catch {
            // Non-fatal; the recurring charge can be corrected from the invoices screen.
          }
        }
      }

      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer', targetCustomerId] });
      void qc.invalidateQueries({ queryKey: ['recurring-charges'] });
      void qc.invalidateQueries({ queryKey: ['recurring-charges', targetCustomerId] });
      void qc.invalidateQueries({ queryKey: ['customerDocs', targetCustomerId] });
      void qc.invalidateQueries({ queryKey: ['customerNotes', targetCustomerId] });
      void qc.invalidateQueries({ queryKey: ['customerComms', targetCustomerId] });
      if (sendForSignature) {
        Alert.alert(
          signatureRequestSent ? 'Agreement Sent for Signature' : 'Agreement Created',
          signatureRequestSent
            ? (existingCustomerId
              ? `${name}'s updated agreement was added. It is marked Unsigned in Documents and an email request was sent.`
              : `${name} was created. The agreement is now marked Unsigned in Documents and an email request was sent.`)
            : (existingCustomerId
              ? `${name}'s updated agreement was added, but the signature email could not be sent. Use Resend Signature Email in Documents.`
              : `${name} was created and agreement is marked Unsigned, but the signature email could not be sent. Use Resend Signature Email in Documents.`),
          [{ text: 'OK', onPress: () => router.replace(`/customer/${targetCustomerId}?tab=Documents`) }],
        );
      } else {
        Alert.alert(
          'Agreement Signed',
          existingCustomerId
            ? (isUpdate
              ? `${name}'s agreement was updated.${initialInvoiceId ? ` ${money(chargeTotal)} for the added services was invoiced${'.'}` : ' No new initial charges.'} Recurring is now ${money(regularTotal)}/service.`
              : `${name}'s updated signed agreement was saved.`)
            : `${name} has been added and the signed agreement was saved.\n\nAdd a payment method now to save it on file${initialInvoiceId ? ' and collect the initial service charge' : ''}.`,
          existingCustomerId
            ? [{ text: 'OK', onPress: () => router.replace(`/customer/${targetCustomerId}?tab=Documents`) }]
            : [
                { text: 'Later', style: 'cancel', onPress: () => router.replace(`/customer/${targetCustomerId}`) },
                {
                  text: 'Add Payment Method',
                  onPress: () =>
                    router.replace({
                      pathname: '/customer/[id]',
                      params: initialInvoiceId
                        ? {
                          id: targetCustomerId,
                          tab: 'Payment Methods',
                          promptPayment: '1',
                          promptInitialCharge: '1',
                          initialInvoiceId,
                        }
                        : { id: targetCustomerId, tab: 'Payment Methods', promptPayment: '1' },
                    }),
                },
              ],
        );
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ gestureEnabled: !signing, title: isUpdate ? 'Update Agreement' : 'Service Agreement' }} />
        {isUpdate ? (
          <View style={styles.updateBanner}>
            <Text style={styles.updateBannerTitle}>Updating the current agreement</Text>
            <Text style={styles.updateBannerText}>Only services that are new versus the current agreement are charged now. The recurring amount changes from {money(previousRecurring)} to the new total.</Text>
          </View>
        ) : null}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

        {/* ---------- Service frequency ---------- */}
        <Text style={styles.pickHeader}>Service Frequency</Text>
        <Text style={styles.pickSub}>How often the regular service is performed and charged.</Text>
        <View style={styles.freqRow}>
          {SERVICE_FREQUENCIES.map((f) => {
            const active = frequency === f;
            return (
              <TouchableOpacity key={f} style={[styles.freqChip, active && styles.freqChipActive]} onPress={() => setFrequency(f)} activeOpacity={0.85}>
                <Text style={[styles.freqChipText, active && styles.freqChipTextActive]}>{SERVICE_FREQUENCY_LABELS[f]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
        {isOwner && lineItems.length ? (
          <View style={styles.ownerPriceCard}>
            <Text style={styles.ownerPriceTitle}>Owner Price Overrides</Text>
            <Text style={styles.ownerPriceHint}>Adjust initial/regular amounts before saving or sending for signature.</Text>
            {baseLineItems.map((item) => (
              <View key={item.key} style={styles.ownerPriceRow}>
                <Text style={styles.ownerPriceLabel}>{item.label}</Text>
                <View style={styles.ownerPriceInputs}>
                  <View style={styles.ownerPriceInputWrap}>
                    <Text style={styles.ownerPriceInputLabel}>Initial</Text>
                    <TextInput
                      style={styles.ownerPriceInput}
                      keyboardType="decimal-pad"
                      value={priceOverrides[item.key]?.initial ?? item.initial.toFixed(2)}
                      onChangeText={(value) => setPriceOverride(item.key, 'initial', value)}
                    />
                  </View>
                  <View style={styles.ownerPriceInputWrap}>
                    <Text style={styles.ownerPriceInputLabel}>Regular</Text>
                    <TextInput
                      style={styles.ownerPriceInput}
                      keyboardType="decimal-pad"
                      value={priceOverrides[item.key]?.regular ?? item.regular.toFixed(2)}
                      onChangeText={(value) => setPriceOverride(item.key, 'regular', value)}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.discountCard}>
          <Text style={styles.discountTitle}>Initial Service Discount</Text>
          <Text style={styles.discountHint}>
            {isUpdate ? 'Enter a one-time discount to apply to the amount due now.' : 'Enter the one-time discount to apply to the initial total.'}
          </Text>
          <TextInput
            style={styles.discountInput}
            keyboardType="decimal-pad"
            value={initialDiscountInput}
            onChangeText={(value) => setInitialDiscountInput(normalizePriceInput(value))}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
          />
          {discountWasCapped ? (
            <Text style={styles.discountClampNote}>
              Discount capped at {isUpdate ? 'the amount due now' : 'initial subtotal'} ({money(isUpdate ? chargeSubtotal : initialSubtotal)}).
            </Text>
          ) : null}
        </View>

        <View style={styles.totalsBar}>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>{isUpdate ? 'DUE NOW' : 'INITIAL'}</Text>
            <Text style={styles.totalValue}>{money(isUpdate ? chargeTotal : initialTotal)}</Text>
            {initialDiscount > 0 ? <Text style={styles.totalDiscount}>includes discount -{money(initialDiscount)}</Text> : null}
            {isUpdate ? <Text style={styles.totalDiscount}>{chargeItems.length ? `${chargeItems.length} new item${chargeItems.length > 1 ? 's' : ''}` : 'no new initial charges'}</Text> : null}
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>RECURRING</Text>
            <Text style={styles.totalValue}>{money(regularTotal)}<Text style={styles.totalPer}>{SERVICE_FREQUENCY_SHORT[frequency]}</Text></Text>
            {isUpdate ? <Text style={styles.totalDiscount}>was {money(previousRecurring)}/service</Text> : <Text style={styles.totalDiscount}>{SERVICE_FREQUENCY_LABELS[frequency]}</Text>}
          </View>
        </View>

        {/* ---------- Captured document ---------- */}
        <View ref={docRef} collapsable={false} style={styles.doc}>
          <View style={styles.brandHeader}>
            <Image source={require('../../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.brandName}>{company.name}</Text>
              <Text style={styles.brandTagline}>PEST CONTROL</Text>
            </View>
            <View style={styles.brandContact}>
              {company.addressLines.map((line) => (
                <Text key={line} style={styles.brandContactLine}>{line}</Text>
              ))}
              <Text style={styles.brandContactLine}>{company.phone}</Text>
              <Text style={styles.brandContactLine}>{company.email}</Text>
              <Text style={styles.brandContactLine}>{company.license}</Text>
            </View>
          </View>

          <Text style={styles.docTitle}>SERVICE AGREEMENT</Text>
          {sendForSignature ? <Text style={styles.pendingBanner}>Pending customer signature</Text> : null}

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
            <Text style={[styles.tblCell, styles.tblNum, styles.tblHeadText]}>{SERVICE_FREQUENCY_LABELS[frequency]}</Text>
          </View>
          {lineItems.length === 0 ? (
            <Text style={styles.termsMuted}>No services selected yet.</Text>
          ) : (
            lineItems.map((i) => (
              <View key={i.key} style={styles.tblRow}>
                <Text style={[styles.tblCell, styles.tblItem]}>{i.label}</Text>
                <Text style={[styles.tblCell, styles.tblNum]}>{i.initial ? money(i.initial) : '—'}</Text>
                <Text style={[styles.tblCell, styles.tblNum]}>{i.regular ? money(i.regular) : '—'}</Text>
              </View>
            ))
          )}
          <View style={styles.tblTotal}>
            <Text style={[styles.tblCell, styles.tblItem, styles.tblTotalText]}>SUBTOTAL</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(initialSubtotal)}</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(regularTotal)}</Text>
          </View>
          {initialDiscount > 0 ? (
            <View style={styles.tblRow}>
              <Text style={[styles.tblCell, styles.tblItem, styles.discountRowText]}>Initial Discount</Text>
              <Text style={[styles.tblCell, styles.tblNum, styles.discountRowText]}>-{money(initialDiscount)}</Text>
              <Text style={[styles.tblCell, styles.tblNum]}>—</Text>
            </View>
          ) : null}
          <View style={styles.tblTotal}>
            <Text style={[styles.tblCell, styles.tblItem, styles.tblTotalText]}>TOTAL</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(initialTotal)}</Text>
            <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(regularTotal)}</Text>
          </View>
          {isUpdate ? (
            <View style={styles.tblTotal}>
              <Text style={[styles.tblCell, styles.tblItem, styles.tblTotalText]}>DUE NOW (new services only)</Text>
              <Text style={[styles.tblCell, styles.tblNum, styles.tblTotalText]}>{money(chargeTotal)}</Text>
              <Text style={[styles.tblCell, styles.tblNum]}>—</Text>
            </View>
          ) : null}

          {/* Charge schedule across the term */}
          <Text style={styles.sectionBarFull}>{SERVICE_FREQUENCY_LABELS[frequency]} Service Schedule</Text>
          {lineItems.length === 0 ? (
            <Text style={styles.termsMuted}>Select services to see the schedule.</Text>
          ) : (
            <>
              <View style={styles.schedGrid}>
                {chargeSchedule.map((entry) => (
                  <View key={entry.date} style={styles.schedCell}>
                    <Text style={[styles.schedHead, entry.kind === 'initial' && styles.schedHeadInitial]}>{scheduleCellLabel(entry.date, frequency)}</Text>
                    <Text style={styles.schedAmount}>{entry.kind === 'initial' ? '(I) ' : ''}{money(entry.amount)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.schedNote}>
                (I) {isUpdate ? 'due now for the added services' : 'initial service'}. Regular service {money(regularTotal)} {SERVICE_FREQUENCY_LABELS[frequency].toLowerCase()} through the {TERM_MONTHS}-month term, continuing at the same cadence until canceled.
              </Text>
            </>
          )}

          {/* Covered pests */}
          <Text style={styles.sectionBarFull}>Covered Pests</Text>
          {coveredPests.length === 0 ? (
            <Text style={styles.termsMuted}>No pests selected yet.</Text>
          ) : (
            <View style={styles.pestListWrap}>
              {coveredPests.map((p) => (
                <View key={p} style={styles.pestTag}>
                  <Image source={pestImage(p)} style={styles.pestTagIcon} resizeMode="contain" />
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
            scheduled visits if covered pest activity persists. If this agreement is terminated before the end of
            the {TERM_MONTHS}-month term, the customer agrees to repay any initial service discount applied under
            this agreement.
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
            <TouchableOpacity activeOpacity={0.8} onPress={() => setSigning(true)} style={styles.signArea}>
              {signatureDataUrl ? (
                <SignatureMark dataUrl={signatureDataUrl} style={styles.signImage} />
              ) : (
                <View style={styles.signPlaceholder}>
                  <Ionicons name="create-outline" size={22} color={colors.primaryDark} />
                  <Text style={styles.signPlaceholderText}>Tap to Sign</Text>
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.signedOn}>Signed on: {signedDate}</Text>
          </View>
        </View>

        {/* ---------- Controls ---------- */}
        <View style={styles.controls}>
        <TouchableOpacity style={styles.agreeRow} onPress={() => setSendForSignature((v) => !v)} activeOpacity={0.7}>
          <View style={[styles.checkbox, sendForSignature && styles.checkboxOn]}>
            {sendForSignature && <Ionicons name="checkmark" size={16} color="#0D0D0D" />}
          </View>
          <Text style={styles.agreeText}>Send to customer email to review and sign (creates Unsigned document).</Text>
        </TouchableOpacity>
        {sendForSignature ? (
          <Text style={styles.sendHint}>When the customer signs and uploads the agreement, this document will show Signed.</Text>
        ) : null}
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
          <TouchableOpacity style={styles.clearBtn} onPress={() => setSigning(true)} disabled={sendForSignature}>
            <Ionicons name="create-outline" size={16} color={colors.primaryDark} />
            <Text style={[styles.clearBtnText, sendForSignature && { opacity: 0.5 }]}>
              {signatureDataUrl ? 'Re-Sign' : 'Sign Agreement'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.agreeRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.7} disabled={sendForSignature}>
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed && <Ionicons name="checkmark" size={16} color="#0D0D0D" />}
            </View>
            <Text style={[styles.agreeText, sendForSignature && { opacity: 0.5 }]}>I have read and accept the terms of this service agreement.</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.submitBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={20} color="#0D0D0D" />
          <Text style={styles.submitText}>
            {busy
              ? 'Saving…'
              : existingCustomerId
                ? sendForSignature
                  ? 'Save Agreement & Send for Signature'
                  : 'Save Signed Agreement'
                : sendForSignature
                  ? 'Create Customer & Send for Signature'
                  : 'Agree & Create Customer'}
          </Text>
        </TouchableOpacity>
      </View>

      {signing && (
        <SigningOverlay
          onCancel={() => setSigning(false)}
          onDone={(uri) => {
            setSignatureDataUrl(uri);
            setSigning(false);
          }}
        />
      )}
    </View>
  );
}

function SigningOverlay({ onCancel, onDone }: { onCancel: () => void; onDone: (uri: string) => void }) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (padRef.current?.isEmpty()) {
      Alert.alert('Signature required', 'Please sign before saving.');
      return;
    }
    setSaving(true);
    try {
      const tmp = await padRef.current!.capture();
      onDone(tmp);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.overlayHeader}>
          <TouchableOpacity onPress={onCancel} style={styles.overlayClose}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.overlayTitle}>Sign Agreement</Text>
          <View style={{ width: 26 }} />
        </View>
        <Text style={styles.overlayHint}>Sign inside the box below. The page won't move.</Text>
        <View style={styles.overlayPadWrap}>
          <SignaturePad ref={padRef} height={320} />
          <View style={styles.overlaySignLine} />
        </View>
        <View style={styles.overlayActions}>
          <TouchableOpacity style={styles.overlayClearBtn} onPress={() => padRef.current?.clear()}>
            <Ionicons name="refresh" size={18} color={colors.primaryDark} />
            <Text style={styles.overlayClearText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.overlaySaveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            <Ionicons name="checkmark" size={20} color="#0D0D0D" />
            <Text style={styles.overlaySaveText}>{saving ? 'Saving…' : 'Done'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  updateBanner: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#EAF8F5', borderWidth: 1, borderColor: '#BFE8DF' },
  updateBannerTitle: { fontWeight: '800', color: '#0D0D0D', marginBottom: 4 },
  updateBannerText: { color: '#30433F', fontSize: 13, lineHeight: 18 },
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
  ownerPriceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 14,
  },
  ownerPriceTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  ownerPriceHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 10 },
  ownerPriceRow: { marginBottom: 10 },
  ownerPriceLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 },
  ownerPriceInputs: { flexDirection: 'row', justifyContent: 'space-between' },
  ownerPriceInputWrap: { width: '48.5%' },
  ownerPriceInputLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  ownerPriceInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    color: colors.text,
  },
  discountCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 12,
  },
  discountTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  discountHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  discountInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    color: colors.text,
    maxWidth: 160,
  },
  discountClampNote: { fontSize: 11, color: '#B26B00', marginTop: 6 },
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
  totalDiscount: { color: '#6B7C78', fontSize: 10, fontWeight: '700', marginTop: 3 },
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
  pendingBanner: {
    textAlign: 'center',
    color: '#B26B00',
    fontSize: 12,
    fontWeight: '800',
    marginTop: -4,
    marginBottom: 10,
  },
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
  schedGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 },
  schedCell: { width: '16.66%', paddingHorizontal: 2, marginBottom: 4 },
  schedHead: { backgroundColor: colors.primary, color: '#0D0D0D', fontWeight: '800', fontSize: 9, textAlign: 'center', paddingVertical: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  schedHeadInitial: { backgroundColor: '#0D0D0D', color: '#fff' },
  schedAmount: { fontSize: 9, color: colors.text, textAlign: 'center', paddingVertical: 3, borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  schedNote: { fontSize: 10, color: colors.textMuted, marginTop: 4, lineHeight: 14 },
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  freqChip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8, backgroundColor: '#fff' },
  freqChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  freqChipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  freqChipTextActive: { color: '#0D0D0D' },
  discountRowText: { color: '#B3261E', fontWeight: '800' },
  termsMuted: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
  pestListWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pestTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9FBF6', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, marginRight: 6, marginBottom: 6, borderWidth: 1, borderColor: colors.border },
  pestTagIcon: { width: 16, height: 16, marginRight: 5 },
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
  sendHint: { fontSize: 12, color: colors.textMuted, marginTop: 8, marginBottom: 8 },
  bottomBar: { padding: 14, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.border },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15 },
  submitText: { color: '#0D0D0D', fontWeight: '900', fontSize: 16, marginLeft: 8 },
  signArea: {
    height: 150,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 10,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  signImage: { width: '100%', height: '100%' },
  signPlaceholder: { alignItems: 'center' },
  signPlaceholderText: { color: colors.primaryDark, fontWeight: '800', fontSize: 14, marginTop: 4 },
  overlay: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 54,
    paddingHorizontal: 16,
  },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overlayClose: { padding: 4 },
  overlayTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  overlayHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  overlayPadWrap: { position: 'relative' },
  overlaySignLine: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 42,
    height: 1,
    backgroundColor: colors.border,
  },
  overlayActions: { flexDirection: 'row', marginTop: 20 },
  overlayClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 22,
    marginRight: 12,
  },
  overlayClearText: { color: colors.primaryDark, fontWeight: '800', fontSize: 15, marginLeft: 6 },
  overlaySaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  overlaySaveText: { color: '#0D0D0D', fontWeight: '900', fontSize: 16, marginLeft: 6 },
});
