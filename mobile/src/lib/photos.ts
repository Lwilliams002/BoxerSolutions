import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from './api';

export interface PendingPhoto {
  localUri: string;
  fileType: 'service_photo' | 'customer_photo' | 'signature' | 'document';
  fileName: string;
  mimeType: string;
  customerId?: string | null;
  appointmentId?: string | null;
}

export async function compressPhoto(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/** Copy a captured photo into app storage so it survives until upload succeeds. */
export async function persistLocally(uri: string, fileName: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}pending-photos/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${Date.now()}-${fileName}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

export async function persistSignatureCapture(uri: string, fileName: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}pending-photos/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${Date.now()}-${fileName}`;

  if (uri.startsWith('data:image/svg+xml;utf8,')) {
    const svg = decodeURIComponent(uri.split(',')[1] ?? '');
    await FileSystem.writeAsStringAsync(dest, svg);
    return dest;
  }

  if (uri.startsWith('data:image/') && uri.includes(';base64,')) {
    const base64 = uri.split(';base64,')[1] ?? '';
    await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
    return dest;
  }

  if (uri.startsWith('/') || uri.startsWith('file://') || uri.startsWith('content://')) {
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  }

  await FileSystem.writeAsStringAsync(dest, uri, { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}

interface UploadAuthorization {
  file: { id: string; storageObjectKey: string };
  uploadUrl: string;
}

/**
 * Full upload pipeline: request presigned URL → PUT bytes → confirm.
 * Local copy is deleted only after the server confirms the upload.
 */
export async function uploadPendingPhoto(photo: PendingPhoto): Promise<string> {
  const auth = await api<UploadAuthorization>('/files/upload-request', {
    method: 'POST',
    body: {
      fileType: photo.fileType,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      customerId: photo.customerId ?? null,
      appointmentId: photo.appointmentId ?? null,
    },
  });

  const result = await FileSystem.uploadAsync(auth.uploadUrl, photo.localUri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': photo.mimeType },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage upload failed (${result.status})`);
  }

  await api(`/files/${auth.file.id}/confirm`, { method: 'POST', body: {} });

  await FileSystem.deleteAsync(photo.localUri, { idempotent: true }).catch(() => {});
  return auth.file.id;
}
