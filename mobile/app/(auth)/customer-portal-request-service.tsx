import React, { useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { customerPortalApi } from '../../src/lib/customerPortalApi';
import { Button, Card, Loading, StatusBadge } from '../../src/components/ui';
import { colors, fmtDate, money } from '../../src/lib/theme';
import { compressPhoto, persistLocally } from '../../src/lib/photos';
import { CustomerPortalServiceRequest, Paginated } from '../../src/lib/types';

interface UploadAuthorization {
  file: { id: string };
  uploadUrl: string;
}

interface LocalPhoto {
  uri: string;
  fileName: string;
  mimeType: string;
}

export default function CustomerPortalRequestServiceScreen() {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);

  const requests = useQuery({
    queryKey: ['portal-service-requests'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalServiceRequest>>('/service-requests?page=1&pageSize=20'),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (description.trim().length < 10) throw new Error('Please describe the issue in more detail.');
      const photoFileIds: string[] = [];
      for (const p of photos) {
        const compressed = await compressPhoto(p.uri);
        const localUri = await persistLocally(compressed, p.fileName);
        const auth = await customerPortalApi<UploadAuthorization>('/files/upload-request', {
          method: 'POST',
          body: {
            fileName: p.fileName,
            mimeType: p.mimeType,
          },
        });
        const result = await FileSystem.uploadAsync(auth.uploadUrl, localUri, {
          httpMethod: 'PUT',
          headers: { 'Content-Type': p.mimeType },
        });
        if (result.status < 200 || result.status >= 300) throw new Error(`Photo upload failed (${result.status})`);
        await customerPortalApi(`/files/${auth.file.id}/confirm`, { method: 'POST', body: {} });
        await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
        photoFileIds.push(auth.file.id);
      }
      await customerPortalApi('/service-requests', {
        method: 'POST',
        body: { description: description.trim(), photoFileIds },
      });
    },
    onSuccess: async () => {
      setDescription('');
      setPhotos([]);
      await qc.invalidateQueries({ queryKey: ['portal-service-requests'] });
      Alert.alert('Request submitted', 'Your service request was sent to the office for review.');
    },
    onError: (e) => Alert.alert('Unable to submit request', (e as Error).message),
  });

  const addPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow photo access to attach images.');
      return;
    }
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    if (pick.canceled || !pick.assets.length) return;
    const asset = pick.assets[0];
    const guessedType = asset.mimeType || 'image/jpeg';
    const ext = guessedType === 'image/png' ? 'png' : 'jpg';
    setPhotos((prev) => [
      ...prev,
      {
        uri: asset.uri,
        mimeType: guessedType,
        fileName: asset.fileName ?? `request-photo-${Date.now()}.${ext}`,
      },
    ]);
  };

  const submittedCount = useMemo(
    () => (requests.data?.items ?? []).filter((r) => r.status === 'submitted').length,
    [requests.data?.items],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Request Service</Text>
        <Text style={styles.meta}>Describe the issue and attach photos so the office can assign a technician and quote.</Text>
        <TextInput
          style={styles.description}
          multiline
          placeholder="Example: We are seeing wasps near the back patio and garage..."
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
          textAlignVertical="top"
        />
        <Button title="Add Photo" variant="outline" onPress={() => void addPhoto()} />
        {photos.length > 0 ? (
          <View style={styles.photoStrip}>
            {photos.map((p, idx) => (
              <Image key={`${p.uri}-${idx}`} source={{ uri: p.uri }} style={styles.photo} />
            ))}
          </View>
        ) : null}
        <Button
          title="Submit Request"
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={description.trim().length < 10}
        />
      </Card>

      <Card>
        <Text style={styles.title}>My Requests</Text>
        <Text style={styles.meta}>{submittedCount} awaiting review</Text>
        {requests.isLoading ? <Loading /> : null}
        {(requests.data?.items ?? []).map((r) => (
          <View key={r.id} style={styles.requestRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.requestText} numberOfLines={2}>{r.description}</Text>
              <Text style={styles.requestMeta}>{fmtDate(r.requested_at)} · {r.files.length} photo(s)</Text>
              {r.quoted_price != null ? <Text style={styles.quote}>Quoted: {money(r.quoted_price)}</Text> : null}
            </View>
            <StatusBadge status={r.status} />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 24 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  meta: { color: colors.textMuted, marginBottom: 10 },
  description: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.bg,
    color: colors.text,
    padding: 12,
    marginBottom: 10,
  },
  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  photo: { width: 72, height: 72, borderRadius: 10, marginRight: 8, marginBottom: 8 },
  requestRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestText: { color: colors.text, fontWeight: '600', marginRight: 8 },
  requestMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quote: { color: colors.success, fontSize: 12, marginTop: 3, fontWeight: '700' },
});
