import { captureRef } from 'react-native-view-shot';
import type { RefObject } from 'react';

export async function captureView(ref: RefObject<unknown>): Promise<string> {
  return captureRef(ref, { format: 'png', quality: 0.95, result: 'tmpfile' });
}
