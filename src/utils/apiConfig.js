// ============================================================
//  apiConfig.js  —  HerbanalytiX
//  Persists the Pi server URL so it can be changed in Settings.
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_PI_URL = 'http://192.168.100.171:5000';
const STORAGE_KEY = '@herbanalytix:piUrl';

/** Returns the saved Pi URL, or the default if none saved. */
export async function getApiBase() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return saved ?? DEFAULT_PI_URL;
  } catch {
    return DEFAULT_PI_URL;
  }
}

/** Persists a new Pi URL to AsyncStorage. */
export async function saveApiBase(url) {
  await AsyncStorage.setItem(STORAGE_KEY, url.trim());
}
