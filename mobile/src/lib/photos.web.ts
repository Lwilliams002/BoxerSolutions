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
  return uri;
}

export async function persistLocally(uri: string, _fileName: string): Promise<string> {
  return uri;
}

export async function persistSignatureCapture(uri: string, _fileName: string): Promise<string> {
  return uri;
}

interface UploadAuthorization {
  file: { id: string; storageObjectKey: string };
  uploadUrl: string;
}

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

  const payload = await fetch(photo.localUri).then((res) => {
    if (!res.ok) throw new Error(`Unable to read selected file (${res.status})`);
    return res.blob();
  });
  const result = await fetch(auth.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': photo.mimeType },
    body: payload,
  });
  if (!result.ok) {
    throw new Error(`Storage upload failed (${result.status})`);
  }

  await api(`/files/${auth.file.id}/confirm`, { method: 'POST', body: {} });
  return auth.file.id;
}
