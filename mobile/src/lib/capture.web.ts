import type { RefObject } from 'react';

export async function captureView(_ref: RefObject<unknown>): Promise<string> {
  throw new Error('View capture is unavailable on web.');
}
