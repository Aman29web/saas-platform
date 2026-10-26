import axios, { type AxiosError } from "axios";
import { notifyToast } from "./toast-bridge";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  withCredentials: true,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const message = error.response?.data?.message ?? error.message ?? "Something went wrong";
    notifyToast(Array.isArray(message) ? message.join(", ") : message, "error");
    return Promise.reject(error);
  },
);
