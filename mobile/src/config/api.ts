import Constants from "expo-constants";
import { Platform } from "react-native";

const envUrl = process.env.EXPO_PUBLIC_API_URL;
const isIosSimulator = Platform.OS === "ios" && !Constants.isDevice;
const fallbackUrl = isIosSimulator
  ? "http://localhost:8000"
  : "http://192.168.1.100:8000";

export const API_BASE_URL = envUrl ?? fallbackUrl;

export const logApiBaseUrl = (context: string) => {
  console.log(`[api] ${context} base url: ${API_BASE_URL}`);
  if (!envUrl && !isIosSimulator) {
    console.log(
      "[api] Set EXPO_PUBLIC_API_URL to your LAN IP or ngrok URL for physical devices."
    );
  }
};
