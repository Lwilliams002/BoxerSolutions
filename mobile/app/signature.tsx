import React, { useRef, useState } from 'react';
import { View, StyleSheet, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { useSync } from '../src/lib/offline';
import { persistLocally, uploadPendingPhoto, PendingPhoto } from '../src/lib/photos';
import { SignaturePad, SignaturePadHandle } from '../src/components/SignaturePad';
import { Button, SectionTitle } from '../src/components/ui';
import { colors } from '../src/lib/theme';

export default function SignatureScreen() {
  const { appointmentId, customerId } = useLocalSearchParams<{ appointmentId: string; customerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const padRef = useRef<SignaturePadHandle>(null);
  const [signerName, setSignerName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (padRef.current?.isEmpty()) {
      Alert.alert('Signature required', 'Please sign before saving.');
      return;
    }
    setBusy(true);
    try {
      const uri = await padRef.current!.capture();
      const fileName = `signature-${Date.now()}.png`;
      const localUri = await persistLocally(uri, fileName);
      const pending: PendingPhoto = {
        localUri,
        fileType: 'signature',
        fileName,
        mimeType: 'image/png',
        appointmentId,
        customerId,
      };
      try {
        const fileId = await uploadPendingPhoto(pending);
        await api('/files/signatures', {
          method: 'POST',
          body: { appointmentId, fileId, signerName: signerName.trim() || null },
        });
        void qc.invalidateQueries({ queryKey: ['signatures', appointmentId] });
        router.back();
      } catch {
        // Offline: keep the image locally; the signature record is created after upload syncs.
        await useSync.getState().enqueuePhoto(pending);
        Alert.alert('Saved offline', 'Signature will upload when you are back online.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <SectionTitle>Sign Below</SectionTitle>
      <SignaturePad ref={padRef} height={280} />
      <TextInput
        style={styles.input}
        placeholder="Signer name (optional)"
        placeholderTextColor={colors.textMuted}
        value={signerName}
        onChangeText={setSignerName}
      />
      <Button title="Save Signature" onPress={save} loading={busy} />
      <Button title="Clear" variant="outline" onPress={() => padRef.current?.clear()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.bg },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 15,
    marginTop: 12,
    marginBottom: 8,
    color: colors.text,
  },
});
