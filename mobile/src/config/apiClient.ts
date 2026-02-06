import { Platform } from "react-native";

import { API_BASE_URL } from "./api";
import { getAccessToken, refreshSession } from "./auth";

const CLIENT_TYPE = Platform.OS === "web" ? "web" : "mobile";

const buildHeaders = (headers?: HeadersInit) => {
  const token = getAccessToken();
  return {
    ...(headers ?? {}),
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Client-Type": CLIENT_TYPE,
  };
};

const withCredentials = Platform.OS === "web" ? "include" : "omit";

export const apiFetch = async (
  path: string,
  options: RequestInit = {},
  retry = true
) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers),
    credentials: withCredentials,
  });

  if (response.status === 401 && retry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch(path, options, false);
    }
  }
  return response;
};

export const apiFetchWithTimeout = async (
  path: string,
  options: RequestInit,
  timeoutMs: number,
  retryCount: number
) => {
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await apiFetch(
        path,
        { ...options, signal: controller.signal },
        true
      );
      clearTimeout(timeoutId);
      return { response };
    } catch (error) {
      clearTimeout(timeoutId);
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      if (!isTimeout || attempt >= retryCount) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Request timed out.");
};
