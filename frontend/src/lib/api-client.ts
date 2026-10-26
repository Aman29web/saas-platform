import axios, { type AxiosError } from "axios";
import { notifyToast } from "./toast-bridge";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  withCredentials: true,
});

const ACTIVE_ORG_STORAGE_KEY = "activeOrgId";

export function getActiveOrgId(): string | null {
  return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
}

export function setActiveOrgId(orgId: string | null): void {
  if (orgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
  else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
}

apiClient.interceptors.request.use((config) => {
  const orgId = getActiveOrgId();
  if (orgId) config.headers.set("X-Org-Id", orgId);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const message = error.response?.data?.message ?? error.message ?? "Something went wrong";
    notifyToast(Array.isArray(message) ? message.join(", ") : message, "error");
    return Promise.reject(error);
  },
);
