import Constants from 'expo-constants';

// For a physical device, set EXPO_PUBLIC_API_URL to your machine's LAN IP,
// e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
const explicit = process.env.EXPO_PUBLIC_API_URL;

function inferHost(): string {
  // Expo dev server host — lets simulators/devices reach the API on the same machine.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:4000`;
  }
  return 'http://localhost:4000';
}

export const API_BASE_URL = explicit ?? inferHost();
export const API_URL = `${API_BASE_URL}/api/v1`;
