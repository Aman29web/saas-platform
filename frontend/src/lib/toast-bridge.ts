import type { ToastVariant } from "@/components/toast/toast-context";

/**
 * Lets the axios interceptor (plain module code, not a component) surface
 * API errors as toasts without needing React context at the module level.
 * Set once by ToastBridge, a tiny component rendered inside ToastProvider.
 */
let notify: ((message: string, variant?: ToastVariant) => void) | null = null;

export function registerToastNotifier(fn: typeof notify): void {
  notify = fn;
}

export function notifyToast(message: string, variant?: ToastVariant): void {
  notify?.(message, variant);
}
