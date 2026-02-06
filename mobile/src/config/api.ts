import Constants from "expo-constants";
import { Platform } from "react-native";

const envUrl = process.env.EXPO_PUBLIC_API_URL;

function getAutoBaseUrl() {
  if (envUrl) return envUrl;

  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return "http://localhost:8000";

  const host = hostUri.split(":")[0];
  return `http://${host}:8000`;
}

export const API_BASE_URL = getAutoBaseUrl();

export const logApiBaseUrl = (context: string) => {
  console.log(`[api] ${context} base url: ${API_BASE_URL}`);
};