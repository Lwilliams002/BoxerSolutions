import React, { useMemo, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  const openPortalFile = async (fileId: string) => {
    try {
      const dl = await customerPortalApi<{ downloadUrl: string }>(`/files/${fileId}/download`);
      await Linking.openURL(dl.downloadUrl);
    } catch (e) {
      Alert.alert('Unable to open photo', (e as Error).message);
    }
  };


  const requests = useQuery({
    queryKey: ['portal-service-requests'],
    queryFn: () => customerPortalApi<Paginated<CustomerPortalServiceRequest>>('/service-requests?page=1&pageSize=20'),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (description.trim().length < 10) throw new Error('Please describe the issue in more detail.');
      const photoFileIds: string[] = [];
      for (const p of photos) {
        // compressPhoto always re-encodes to JPEG, so upload as image/jpeg
        // regardless of the original format (e.g. iPhone HEIC).
        const compressed = await compressPhoto(p.uri);
        const uploadName = p.fileName.replace(/\.[^.]+$/, '') + '.jpg';
        const localUri = await persistLocally(compressed, uploadName);
        const auth = await customerPortalApi<UploadAuthorization>('/files/upload-request', {
          method: 'POST',
          body: {
            fileName: uploadName,
            mimeType: 'image/jpeg',
          },
        });
        const result = await FileSystem.uploadAsync(auth.uploadUrl, localUri, {
          httpMethod: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
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

  const MAX_PHOTOS = 8; // matches the backend's photoFileIds limit

  const addPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow photo access to attach images.');
      return;
    }
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Photo limit reached', `You can attach up to ${MAX_PHOTOS} photos per request.`);
      return;
    }
    // allowsMultipleSelection shows the native checkmark selection UI and
    // lets the customer pick several photos at once.
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
    });
    if (pick.canceled || !pick.assets.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      for (const asset of pick.assets) {
        if (next.length >= MAX_PHOTOS) break;
        if (next.some((p) => p.uri === asset.uri)) continue;
        const guessedType = asset.mimeType || 'image/jpeg';
        const ext = guessedType === 'image/png' ? 'png' : 'jpg';
        next.push({
          uri: asset.uri,
          mimeType: guessedType,
          fileName: asset.fileName ?? `request-photo-${Date.now()}-${next.length}.${ext}`,
        });
      }
      return next;
    });
  };

  const removePhoto = (uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
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
        <Button
          title={photos.length ? `Add Photos (${photos.length}/${MAX_PHOTOS})` : 'Add Photos'}
          variant="outline"
          onPress={() => void addPhoto()}
        />
        {photos.length > 0 ? (
          <>
            <Text style={styles.photoHint}>Tap a photo to remove it.</Text>
            <View style={styles.photoStrip}>
              {photos.map((p, idx) => (
                <TouchableOpacity key={`${p.uri}-${idx}`} onPress={() => removePhoto(p.uri)} style={styles.photoWrap}>
                  <Image source={{ uri: p.uri }} style={styles.photo} />
                  <View style={styles.photoRemoveBadge}>
                    <Text style={styles.photoRemoveText}>✕</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
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
              {r.scheduled_date ? (
                <Text style={styles.visit}>
                  Visit scheduled: {fmtDate(r.scheduled_date)} · {String(r.window_start ?? '').slice(0, 5)}–{String(r.window_end ?? '').slice(0, 5)}
                </Text>
              ) : null}
              {r.quoted_price != null ? <Text style={styles.quote}>Quoted: {money(r.quoted_price)}</Text> : null}
              {r.files.length ? (
                <View style={styles.fileRow}>
                  {r.files.map((file) => (
                    <TouchableOpacity key={file.fileId} style={styles.fileChip} onPress={() => void openPortalFile(file.fileId)}>
                      <Text style={styles.fileChipText}>{file.fileName || 'View photo'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
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
  photoHint: { color: colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: 6 },
  photoWrap: { position: 'relative', marginRight: 8, marginBottom: 8 },
  photo: { width: 72, height: 72, borderRadius: 10 },
  photoRemoveBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  requestRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestText: { color: colors.text, fontWeight: '600', marginRight: 8 },
  requestMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quote: { color: colors.success, fontSize: 12, marginTop: 3, fontWeight: '700' },
  visit: { color: colors.primary, fontSize: 12, marginTop: 3, fontWeight: '700' },
  fileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  fileChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10 },
  fileChipText: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
});
