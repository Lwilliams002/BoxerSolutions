import type { RefObject } from 'react';
import { Platform } from 'react-native';

export async function captureView(ref: RefObject<unknown>): Promise<string> {
  if (Platform.OS === 'web') {
    const mod = await import('./capture.web');
    return mod.captureView(ref);
  }
  const mod = await import('./capture.native');
  return mod.captureView(ref);
}

