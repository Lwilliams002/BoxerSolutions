import Constants from 'expo-constants';

// Preferred override for every environment.
const explicit = process.env.EXPO_PUBLIC_API_URL;
const PROD_API_BASE_URL = 'https://api.boxersolutionspestcontrol.com';

function inferHost(): string {
  // Expo dev server host — lets simulators/devices reach the API on the same machine.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:4000`;
  }
  return 'http://localhost:4000';
}

export const API_BASE_URL = explicit ?? (__DEV__ ? inferHost() : PROD_API_BASE_URL);
export const API_URL = `${API_BASE_URL}/api/v1`;
