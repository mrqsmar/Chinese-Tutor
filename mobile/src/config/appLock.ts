import * as SecureStore from "expo-secure-store";

const APP_LOCK_KEY = "appLockUnlockedAt";
const DEFAULT_UNLOCK_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export const getAppPassword = () =>
  process.env.EXPO_PUBLIC_APP_PASSWORD ?? "";

const parseTimestamp = (value: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

export const hasValidUnlock = async (
  ttlMs: number = DEFAULT_UNLOCK_TTL_MS
) => {
  const stored = await SecureStore.getItemAsync(APP_LOCK_KEY);
  const timestamp = parseTimestamp(stored);
  if (!timestamp) {
    return false;
  }
  if (Date.now() - timestamp > ttlMs) {
    await SecureStore.deleteItemAsync(APP_LOCK_KEY);
    return false;
  }
  return true;
};

export const persistUnlock = async () =>
  SecureStore.setItemAsync(APP_LOCK_KEY, `${Date.now()}`);

export const clearUnlock = async () =>
  SecureStore.deleteItemAsync(APP_LOCK_KEY);
