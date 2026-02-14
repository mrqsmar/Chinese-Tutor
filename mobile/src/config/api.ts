import Constants from "expo-constants";
import { Platform } from "react-native";

const envUrl = process.env.EXPO_PUBLIC_API_URL ?? "";

const isIosSimulator = Platform.OS === "ios" && !Constants.isDevice;

const isPrivateHostname = (hostname: string) => {
  if (hostname === "localhost") return true;
  if (hostname.startsWith("127.")) return true;
  if (hostname.startsWith("10.")) return true;
  if (hostname.startsWith("192.168.")) return true;
  const parts = hostname.split(".");
  if (parts.length === 4 && parts[0] === "172") {
    const second = Number(parts[1]);
    return second >= 16 && second <= 31;
  }
  return false;
};

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const API_BASE_URL = envUrl;

export const assertApiBaseUrl = () => {
  const isDev = process.env.NODE_ENV !== "production";

  if (!envUrl) {
    return {
      ok: false as const,
      reason: "Missing API URL. Set EXPO_PUBLIC_API_URL.",
    };
  }

  const parsed = parseUrl(envUrl);
  if (!parsed) {
    return {
      ok: false as const,
      reason: "Invalid API URL. Please check EXPO_PUBLIC_API_URL.",
    };
  }

  // Only enforce HTTPS in production
  if (!isDev && parsed.protocol !== "https:") {
    return {
      ok: false as const,
      reason: "Production builds require an HTTPS API URL.",
    };
  }

  // Only block private/LAN URLs in production
  if (!isDev && isPrivateHostname(parsed.hostname)) {
    return {
      ok: false as const,
      reason:
        "Private/LAN API URLs are blocked. Use a deployed HTTPS endpoint.",
    };
  }

  return { ok: true as const, url: envUrl };
};

export const logApiBaseUrl = (context: string) => {
  if (!envUrl) {
    console.warn(`[api] ${context} missing EXPO_PUBLIC_API_URL`);
    return;
  }
  console.log(`[api] ${context} base url: ${envUrl}`);
};
