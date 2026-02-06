import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { API_BASE_URL } from "./api";

const REFRESH_TOKEN_KEY = "refreshToken";
const CLIENT_TYPE = Platform.OS === "web" ? "web" : "mobile";

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export const getAccessToken = () => accessToken;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getStoredRefreshToken = async () => {
  if (Platform.OS === "web") {
    return null;
  }
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
};

export const setStoredRefreshToken = async (token: string | null) => {
  if (Platform.OS === "web") {
    return;
  }
  if (!token) {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
};

export const login = async (username: string, password: string) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Type": CLIENT_TYPE,
    },
    credentials: Platform.OS === "web" ? "include" : "omit",
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error("Login failed");
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string | null;
  };

  setAccessToken(data.access_token);
  if (data.refresh_token) {
    await setStoredRefreshToken(data.refresh_token);
  }
};

export const refreshSession = async () => {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const refreshToken = await getStoredRefreshToken();
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Type": CLIENT_TYPE,
      },
      credentials: Platform.OS === "web" ? "include" : "omit",
      body:
        Platform.OS === "web"
          ? JSON.stringify({})
          : JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      setAccessToken(null);
      return false;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string | null;
    };
    setAccessToken(data.access_token);
    if (data.refresh_token) {
      await setStoredRefreshToken(data.refresh_token);
    }
    return true;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
};

export const logout = async () => {
  const refreshToken = await getStoredRefreshToken();
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Type": CLIENT_TYPE,
    },
    credentials: Platform.OS === "web" ? "include" : "omit",
    body:
      Platform.OS === "web"
        ? JSON.stringify({})
        : JSON.stringify({ refresh_token: refreshToken }),
  });
  setAccessToken(null);
  await setStoredRefreshToken(null);
};
