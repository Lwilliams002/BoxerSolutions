import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../src/lib/theme';

export default function PrivacyPolicyScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.meta}>Effective: August 19, 2026</Text>

        <Section title="Who we are">
          Boxer Solutions Pest Control provides pest control services and related software for
          scheduling, service requests, customer communication, and billing.
        </Section>

        <Section title="Information we collect">
          We may collect account information such as name, email, phone number, service address,
          billing details, appointment history, service requests, notes, photos, signatures, and
          location information you share when using the app.
        </Section>

        <Section title="How we use information">
          We use this information to create and manage accounts, schedule and complete services,
          route technicians, process payments, communicate about appointments, store signed service
          agreements, and improve the app and our services.
        </Section>

        <Section title="Location and device data">
          The app may use device location to place customer pins, manage territories, and support
          service operations. We may also collect basic device and app usage data for reliability and
          support.
        </Section>

        <Section title="Sharing">
          We do not sell personal information. We may share information with service providers that
          help us operate the app, process payments, store data, or deliver messages. We may also
          share information when required by law or to protect our rights and customers.
        </Section>

        <Section title="Data retention">
          We keep information for as long as needed to provide services, maintain business records,
          meet legal obligations, and resolve disputes. You can request deletion of your account
          information by contacting us.
        </Section>

        <Section title="Security">
          We use reasonable administrative, technical, and physical safeguards designed to protect
          personal information. No method of storage or transmission is completely secure.
        </Section>

        <Section title="Children">
          Our app is not directed to children under 13, and we do not knowingly collect personal
          information from children under 13.
        </Section>

        <Section title="Your choices">
          You may contact us to update your information, request account deletion, or ask questions
          about how we handle your data.
        </Section>

        <Section title="Contact us">
          Boxer Solutions Pest Control{'\n'}
          Email: service@boxersolutions.com{'\n'}
          Phone: (512) 555-0142
        </Section>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', marginBottom: 12 },
  meta: { color: colors.textMuted, fontSize: 12, marginBottom: 14, fontWeight: '600' },
  section: { marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 4 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
});
